import { create } from 'zustand'
import type { Bando, BandoDataset, CommunityData } from '../types'
import type { BaseLayerId } from '../map/layers'
import { useMarksStore } from './marks'
import { DEFAULT_FILTERS, type FilterState } from './filters'

/** Inline sidebar sections — one open at a time. */
export type SidebarPanel = 'filters' | 'offline' | 'storage' | 'sync' | 'contribute' | 'admin'

/**
 * Approved community corrections applied over the raw dataset, plus community
 * places appended. Runs when either the dataset or community.json arrives.
 */
function mergeCommunity(raw: Bando[], c?: CommunityData): Bando[] {
  if (!c) return raw
  const merged = raw.map((b) => {
    const o = c.overrides[b.id]
    if (!o) return b
    const { lat, lon, ...fields } = o
    const out = { ...b }
    for (const [key, value] of Object.entries(fields)) {
      if (value != null) (out as unknown as Record<string, unknown>)[key] = value
    }
    // Same semantics as a local Move fix: corrected position wins, stale
    // L-EST97 coordinates dropped (recomputed from WGS84 where needed).
    if (lat != null && lon != null) {
      return { ...out, lat, lon, lestX: undefined, lestY: undefined, geocode: 'manual' as const }
    }
    return out
  })
  // The submitter still has their local copy of an approved place — skip the
  // community twin so they don't get a double pin.
  const localIds = new Set(useMarksStore.getState().places.map((p) => p.id))
  for (const p of c.places) {
    if (localIds.has(p.id)) continue
    merged.push({
      id: p.id,
      name: p.name,
      county: '',
      municipality: '',
      address: 'Community spot',
      lat: p.lat,
      lon: p.lon,
      geocode: 'manual',
      photos: [],
      community: true,
    })
  }
  return merged
}

interface AppState {
  /** Dataset with community corrections applied — what the whole app renders. */
  bandos: Bando[]
  /** Dataset as loaded, before community corrections. */
  rawBandos: Bando[]
  scrapedAt?: string
  /** Total size of all thumbnails (from the dataset), for the offline panel. */
  thumbsBytes?: number
  /** Approved community contributions (data/community.json), if published. */
  community?: CommunityData
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
  /** Admin review: pin-move diff drawn on the map ([lon, lat] pairs). */
  reviewDiff?: { before?: [number, number]; after: [number, number] }
  /** One-shot map target for deep links whose id wasn't found. */
  pendingView?: { lat: number; lon: number }
  /** Current map viewport (west,south,east,north + center + zoom), updated on moveend. */
  mapView?: { bounds: [number, number, number, number]; center: [number, number]; zoom: number }
  /** Live zoom, updated continuously during zoom gestures (mapView only updates on moveend). */
  mapZoom?: number
  /** Mobile bottom sheet expanded to show the list. */
  sheetOpen: boolean
  /** Desktop: sidebar slid away so the map has the full viewport. */
  sidebarCollapsed: boolean
  /** Cross-device sync status (email set = signed in). */
  sync: { email?: string; state: 'idle' | 'syncing' | 'error'; lastAt?: number }
  /** Set when a new app version has activated in the background — call it to reload into it. */
  updateApp?: () => void
  setDataset: (d: BandoDataset) => void
  setCommunity: (c?: CommunityData) => void
  select: (id?: number) => void
  setBaseLayer: (l: BaseLayerId) => void
  showToast: (msg: string, action?: { label: string; onClick: () => void }) => void
  setFilters: (patch: Partial<FilterState>) => void
  resetFilters: () => void
  togglePanel: (panel: SidebarPanel) => void
  setPlaceDraft: (draft?: 'picking' | { lat: number; lon: number }) => void
  setMoveTarget: (id?: number) => void
  setReviewDiff: (diff?: { before?: [number, number]; after: [number, number] }) => void
  setPendingView: (view?: { lat: number; lon: number }) => void
  setMapView: (view: { bounds: [number, number, number, number]; center: [number, number]; zoom: number }) => void
  setMapZoom: (zoom: number) => void
  setSheetOpen: (open: boolean) => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useAppStore = create<AppState>((set) => ({
  bandos: [],
  rawBandos: [],
  baseLayer: (localStorage.getItem('bando-map:baseLayer') as BaseLayerId) || 'kaart',
  setDataset: (d) =>
    set((s) => ({
      rawBandos: d.bandos,
      bandos: mergeCommunity(d.bandos, s.community),
      scrapedAt: d.scrapedAt,
      thumbsBytes: d.thumbsBytes,
    })),
  setCommunity: (community) => set((s) => ({ community, bandos: mergeCommunity(s.rawBandos, community) })),
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
  setReviewDiff: (reviewDiff) => set({ reviewDiff }),
  setPendingView: (view) => set({ pendingView: view }),
  sheetOpen: false,
  setMapView: (view) => set({ mapView: view, mapZoom: view.zoom }),
  setMapZoom: (zoom) => set({ mapZoom: zoom }),
  setSheetOpen: (open) => set({ sheetOpen: open }),
  sidebarCollapsed: false,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
}))

// Debug/verification handle (harmless — all state is the user's own, local).
;(window as unknown as { __store: typeof useAppStore }).__store = useAppStore
