import { create } from 'zustand'
import type { Bando, BandoDataset } from '../types'
import type { BaseLayerId } from '../map/layers'
import { DEFAULT_FILTERS, type FilterState } from './filters'

/** Inline sidebar sections — one open at a time. */
export type SidebarPanel = 'filters' | 'offline' | 'storage' | 'sync'

interface AppState {
  bandos: Bando[]
  scrapedAt?: string
  /** Total size of all thumbnails (from the dataset), for the offline panel. */
  thumbsBytes?: number
  selectedId?: number
  baseLayer: BaseLayerId
  toast?: { msg: string; action?: { label: string; onClick: () => void } }
  filters: FilterState
  /** Which inline sidebar section is open, if any. */
  panel?: SidebarPanel
  /** Add-place flow: 'picking' = waiting for a map tap, coords = form open. */
  placeDraft?: 'picking' | { lat: number; lon: number }
  /** Move tool: id of the bando whose next map tap sets the corrected position. */
  moveTarget?: number
  /** One-shot map target for deep links whose id wasn't found. */
  pendingView?: { lat: number; lon: number }
  /** Current map viewport (west,south,east,north + center + zoom), updated on moveend. */
  mapView?: { bounds: [number, number, number, number]; center: [number, number]; zoom: number }
  /** Live zoom, updated continuously during zoom gestures (mapView only updates on moveend). */
  mapZoom?: number
  /** Mobile bottom sheet expanded to show the list. */
  sheetOpen: boolean
  /** Cross-device sync status (email set = signed in). */
  sync: { email?: string; state: 'idle' | 'syncing' | 'error'; lastAt?: number }
  /** Set when a new app version is waiting — call it to activate and reload. */
  updateApp?: () => void
  setDataset: (d: BandoDataset) => void
  select: (id?: number) => void
  setBaseLayer: (l: BaseLayerId) => void
  showToast: (msg: string, action?: { label: string; onClick: () => void }) => void
  setFilters: (patch: Partial<FilterState>) => void
  resetFilters: () => void
  togglePanel: (panel: SidebarPanel) => void
  setPlaceDraft: (draft?: 'picking' | { lat: number; lon: number }) => void
  setMoveTarget: (id?: number) => void
  setPendingView: (view?: { lat: number; lon: number }) => void
  setMapView: (view: { bounds: [number, number, number, number]; center: [number, number]; zoom: number }) => void
  setMapZoom: (zoom: number) => void
  setSheetOpen: (open: boolean) => void
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
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: DEFAULT_FILTERS }),
  togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? undefined : panel })),
  sync: { state: 'idle' },
  setPlaceDraft: (draft) => set({ placeDraft: draft }),
  setMoveTarget: (id) => set({ moveTarget: id }),
  setPendingView: (view) => set({ pendingView: view }),
  sheetOpen: false,
  setMapView: (view) => set({ mapView: view, mapZoom: view.zoom }),
  setMapZoom: (zoom) => set({ mapZoom: zoom }),
  setSheetOpen: (open) => set({ sheetOpen: open }),
}))

// Debug/verification handle (harmless — all state is the user's own, local).
;(window as unknown as { __store: typeof useAppStore }).__store = useAppStore
