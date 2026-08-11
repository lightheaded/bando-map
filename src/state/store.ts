import { create } from 'zustand'
import type { Bando, BandoDataset } from '../types'
import type { BaseLayerId } from '../map/layers'
import { DEFAULT_FILTERS, type FilterState } from './filters'

interface AppState {
  bandos: Bando[]
  scrapedAt?: string
  selectedId?: number
  baseLayer: BaseLayerId
  toast?: string
  filters: FilterState
  filtersOpen: boolean
  /** Add-place flow: 'picking' = waiting for a map tap, coords = form open. */
  placeDraft?: 'picking' | { lat: number; lon: number }
  /** One-shot map target for deep links whose id wasn't found. */
  pendingView?: { lat: number; lon: number }
  /** Current map viewport (west,south,east,north + center), updated on moveend. */
  mapView?: { bounds: [number, number, number, number]; center: [number, number] }
  /** Mobile bottom sheet expanded to show the list. */
  sheetOpen: boolean
  setDataset: (d: BandoDataset) => void
  select: (id?: number) => void
  setBaseLayer: (l: BaseLayerId) => void
  showToast: (msg: string) => void
  setFilters: (patch: Partial<FilterState>) => void
  resetFilters: () => void
  setFiltersOpen: (open: boolean) => void
  setPlaceDraft: (draft?: 'picking' | { lat: number; lon: number }) => void
  setPendingView: (view?: { lat: number; lon: number }) => void
  setMapView: (view: { bounds: [number, number, number, number]; center: [number, number] }) => void
  setSheetOpen: (open: boolean) => void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useAppStore = create<AppState>((set) => ({
  bandos: [],
  baseLayer: (localStorage.getItem('bando-map:baseLayer') as BaseLayerId) || 'kaart',
  setDataset: (d) => set({ bandos: d.bandos, scrapedAt: d.scrapedAt }),
  select: (id) => set({ selectedId: id }),
  setBaseLayer: (l) => {
    localStorage.setItem('bando-map:baseLayer', l)
    set({ baseLayer: l })
  },
  showToast: (msg) => {
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ toast: undefined }), 3500)
    set({ toast: msg })
  },
  filters: DEFAULT_FILTERS,
  filtersOpen: false,
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: DEFAULT_FILTERS }),
  setFiltersOpen: (open) => set({ filtersOpen: open }),
  setPlaceDraft: (draft) => set({ placeDraft: draft }),
  setPendingView: (view) => set({ pendingView: view }),
  sheetOpen: false,
  setMapView: (view) => set({ mapView: view }),
  setSheetOpen: (open) => set({ sheetOpen: open }),
}))

if (import.meta.env.DEV) {
  ;(window as unknown as { __store: typeof useAppStore }).__store = useAppStore
}
