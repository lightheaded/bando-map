import { create } from 'zustand'
import type { Bando, BandoDataset, CommunityData, HintLayerDataset, HintSourceId, UasZoneDataset } from '../types'
import { SYNC } from '../sync/config'
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
  // Approved deletions drop out entirely — map, list, search and counts alike.
  const deleted = new Set(c.deleted ?? [])
  const merged = raw.filter((b) => !deleted.has(b.id)).map((b) => {
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
    if (localIds.has(p.id) || deleted.has(p.id)) continue
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
  /** Cross-device sync status (email set = signed in; admin = Cognito group). */
  sync: { email?: string; admin?: boolean; state: 'idle' | 'syncing' | 'error'; lastAt?: number }
  /** Hint-layer datasets, fetched lazily the first time a layer is enabled. */
  hintData: Partial<Record<HintSourceId, HintLayerDataset>>
  loadHint: (id: HintSourceId) => void
  /** One-shot deep-link target for a hint spot (#h/<src>/<id>@lat,lon). */
  pendingHint?: { src: HintSourceId; id: string; lat: number; lon: number }
  setPendingHint: (hint?: { src: HintSourceId; id: string; lat: number; lon: number }) => void
  /** UAS airspace zones, fetched lazily the first time the layer is enabled. */
  zoneData?: UasZoneDataset
  zoneState: 'idle' | 'loading' | 'refreshing'
  loadZones: () => void
  /** Ask the backend to re-poll the official source. Throttled server-side. */
  refreshZones: () => void
  /** Layers menu, anchored under its button on the map. */
  layersPopover: boolean
  setLayersPopover: (open: boolean) => void
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
/** In-flight hint fetches, so a toggle spam doesn't stack requests. */
const hintLoading = new Set<HintSourceId>()

const FILTERS_KEY = 'bando-map:filters'

/** Saved filters merged over the defaults — unknown/removed keys drop out. */
function loadSavedFilters(): FilterState {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '') as Partial<FilterState> & {
      /** Legacy schema: visited was a separate segmented control, not a status. */
      visited?: 'all' | 'visited' | 'unvisited'
    }
    // Migrate the legacy visited control into the status list it merged into.
    if (saved.visited && Array.isArray(saved.status) && !saved.status.includes('visited')) {
      saved.status = saved.visited === 'visited' ? ['visited'] : saved.visited === 'all' ? [...saved.status, 'visited'] : saved.status
    }
    const out = { ...DEFAULT_FILTERS }
    for (const key of Object.keys(DEFAULT_FILTERS) as (keyof FilterState)[]) {
      const value = saved[key]
      if (value !== undefined && typeof value === typeof DEFAULT_FILTERS[key]) {
        ;(out as Record<string, unknown>)[key] = value
      }
    }
    return out
  } catch {
    return DEFAULT_FILTERS
  }
}

const saveFilters = (f: FilterState) => localStorage.setItem(FILTERS_KEY, JSON.stringify(f))

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
  setCommunity: (community) => {
    // A deletion that has gone live settles the local state it came from: a
    // place of the user's own goes (or mergeCommunity's local-twin rule would
    // keep showing it to its author alone), and the pending-deletion mark on a
    // register record clears, so no "deletion proposed" pill outlives the
    // decision it was asking for.
    const { places, marks, removePlace, setMark } = useMarksStore.getState()
    for (const id of community?.deleted ?? []) {
      if (places.some((p) => p.id === id)) removePlace(id)
      else if (marks[id]?.remove) setMark(id, { remove: undefined })
    }
    set((s) => ({ community, bandos: mergeCommunity(s.rawBandos, community) }))
  },
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
  filters: loadSavedFilters(),
  setFilters: (patch) =>
    set((s) => {
      const filters = { ...s.filters, ...patch }
      saveFilters(filters)
      return { filters }
    }),
  resetFilters: () => {
    saveFilters(DEFAULT_FILTERS)
    set({ filters: DEFAULT_FILTERS })
  },
  togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? undefined : panel })),
  sync: { state: 'idle' },
  hintData: {},
  loadHint: (id) => {
    if (useAppStore.getState().hintData[id] || hintLoading.has(id)) return
    hintLoading.add(id)
    fetch(`${import.meta.env.BASE_URL}data/layers/${id}.json`)
      .then((res) => (res.ok ? (res.json() as Promise<HintLayerDataset>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d) => set((s) => ({ hintData: { ...s.hintData, [id]: d } })))
      .catch(() => useAppStore.getState().showToast('Hint layer unavailable — are you offline?'))
      .finally(() => hintLoading.delete(id))
  },
  setPendingHint: (pendingHint) => set({ pendingHint }),
  zoneState: 'idle',
  layersPopover: false,
  setLayersPopover: (layersPopover) => set({ layersPopover }),
  loadZones: () => {
    const s = useAppStore.getState()
    if (s.zoneData || s.zoneState !== 'idle') return
    set({ zoneState: 'loading' })
    fetch(`${import.meta.env.BASE_URL}data/zones.json`)
      .then((res) => (res.ok ? (res.json() as Promise<UasZoneDataset>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((zoneData) => set({ zoneData }))
      .catch(() => useAppStore.getState().showToast('Airspace zones unavailable — are you offline?'))
      .finally(() => set({ zoneState: 'idle' }))
  },
  refreshZones: () => {
    if (useAppStore.getState().zoneState !== 'idle') return
    set({ zoneState: 'refreshing' })
    fetch(`${SYNC.apiUrl}/zones/refresh`, { method: 'POST' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          changed?: boolean
          checkedAt?: string
          fetchedAt?: string
        }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        // Nothing moved: adopt the backend's own timestamps rather than
        // re-downloading a file we already have byte for byte.
        if (!body.changed) {
          set((s) =>
            s.zoneData ? { zoneData: { ...s.zoneData, checkedAt: body.checkedAt ?? s.zoneData.checkedAt } } : {},
          )
          useAppStore.getState().showToast('Airspace zones are already current')
          return
        }
        // The zones moved. The CDN invalidation the backend just issued takes a
        // few seconds to reach every edge, so a re-fetch can still land on the
        // previous copy — the timestamps below come from the backend either way,
        // and the polygons catch up on the next load if this one raced.
        const res2 = await fetch(`${import.meta.env.BASE_URL}data/zones.json`, { cache: 'reload' })
        if (res2.ok) set({ zoneData: (await res2.json()) as UasZoneDataset })
        useAppStore.getState().showToast('Airspace zones updated')
      })
      .catch((err: Error) =>
        useAppStore.getState().showToast(
          // A throw with no response at all is the network (or being offline),
          // not something the backend said — don't surface "Failed to fetch".
          err instanceof TypeError
            ? 'Could not reach the refresh service — the scheduled copy is still shown'
            : err.message,
        ),
      )
      .finally(() => set({ zoneState: 'idle' }))
  },
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
