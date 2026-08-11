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
  setDataset: (d: BandoDataset) => void
  select: (id?: number) => void
  setBaseLayer: (l: BaseLayerId) => void
  showToast: (msg: string) => void
  setFilters: (patch: Partial<FilterState>) => void
  resetFilters: () => void
  setFiltersOpen: (open: boolean) => void
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
}))
