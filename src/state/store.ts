import { create } from 'zustand'
import type { Bando, BandoDataset } from '../types'
import type { BaseLayerId } from '../map/layers'
import { DEFAULT_FILTERS, type FilterState } from './filters'

interface AppState {
  bandos: Bando[]
  scrapedAt?: string
  /** Total size of all thumbnails (from the dataset), for the offline panel. */
  thumbsBytes?: number
  selectedId?: number
  baseLayer: BaseLayerId
  toast?: { msg: string; action?: { label: string; onClick: () => void } }
  filters: FilterState
  filtersOpen: boolean
  /** Add-place flow: 'picking' = waiting for a map tap, coords = form open. */
  placeDraft?: 'picking' | { lat: number; lon: number }
  /** Move tool: id of the bando whose next map tap sets the corrected position. */
  moveTarget?: number
  /** One-shot map target for deep links whose id wasn't found. */
  pendingView?: { lat: number; lon: number }
  /** Current map viewport (west,south,east,north + center + zoom), updated on moveend. */
  mapView?: { bounds: [number, number, number, number]; center: [number, number]; zoom: number }
  /** Mobile bottom sheet expanded to show the list. */
  sheetOpen: boolean
  /** The Offline panel (storage, save-for-offline) is open. */
  offlineOpen: boolean
  setDataset: (d: BandoDataset) => void
  select: (id?: number) => void
  setBaseLayer: (l: BaseLayerId) => void
  showToast: (msg: string, action?: { label: string; onClick: () => void }) => void
  setFilters: (patch: Partial<FilterState>) => void
  resetFilters: () => void
  setFiltersOpen: (open: boolean) => void
  setPlaceDraft: (draft?: 'picking' | { lat: number; lon: number }) => void
  setMoveTarget: (id?: number) => void
  setPendingView: (view?: { lat: number; lon: number }) => void
  setMapView: (view: { bounds: [number, number, number, number]; center: [number, number]; zoom: number }) => void
  setSheetOpen: (open: boolean) => void
  setOfflineOpen: (open: boolean) => void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useAppStore = create<AppState>((set) => ({
  bandos: [],
  baseLayer: (localStorage.getItem('bando-map:baseLayer') as BaseLayerId) || 'kaart',
  setDataset: (d) => set({ bandos: d.bandos, scrapedAt: d.scrapedAt, thumbsBytes: d.thumbsBytes }),
  // Selecting a place also expands the mobile sheet, so the detail card shows.
  select: (id) => set((s) => ({ selectedId: id, sheetOpen: id != null ? true : s.sheetOpen })),
  setBaseLayer: (l) => {
    localStorage.setItem('bando-map:baseLayer', l)
    set({ baseLayer: l })
  },
  showToast: (msg, action) => {
    clearTimeout(toastTimer)
    // Toasts with an action (e.g. Undo) stick around a bit longer.
    toastTimer = setTimeout(() => set({ toast: undefined }), action ? 6000 : 3500)
    set({ toast: { msg, action } })
  },
  filters: DEFAULT_FILTERS,
  filtersOpen: false,
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: DEFAULT_FILTERS }),
  // Filters and Offline are both inline sidebar sections — one at a time.
  setFiltersOpen: (open) => set((s) => ({ filtersOpen: open, offlineOpen: open ? false : s.offlineOpen })),
  offlineOpen: false,
  setOfflineOpen: (open) => set((s) => ({ offlineOpen: open, filtersOpen: open ? false : s.filtersOpen })),
  setPlaceDraft: (draft) => set({ placeDraft: draft }),
  setMoveTarget: (id) => set({ moveTarget: id }),
  setPendingView: (view) => set({ pendingView: view }),
  sheetOpen: false,
  setMapView: (view) => set({ mapView: view }),
  setSheetOpen: (open) => set({ sheetOpen: open }),
}))

// Debug/verification handle (harmless — all state is the user's own, local).
;(window as unknown as { __store: typeof useAppStore }).__store = useAppStore
