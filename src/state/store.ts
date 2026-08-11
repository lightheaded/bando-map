import { create } from 'zustand'
import type { Bando, BandoDataset } from '../types'
import type { BaseLayerId } from '../map/layers'

interface AppState {
  bandos: Bando[]
  scrapedAt?: string
  selectedId?: number
  baseLayer: BaseLayerId
  setDataset: (d: BandoDataset) => void
  select: (id?: number) => void
  setBaseLayer: (l: BaseLayerId) => void
}

export const useAppStore = create<AppState>((set) => ({
  bandos: [],
  baseLayer: (localStorage.getItem('bando-map:baseLayer') as BaseLayerId) || 'kaart',
  setDataset: (d) => set({ bandos: d.bandos, scrapedAt: d.scrapedAt }),
  select: (id) => set({ selectedId: id }),
  setBaseLayer: (l) => {
    localStorage.setItem('bando-map:baseLayer', l)
    set({ baseLayer: l })
  },
}))
