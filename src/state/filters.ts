import { useMemo } from 'react'
import { useAppStore } from './store'
import { useMarksStore } from './marks'
import type { Bando, CustomPlace, HintSourceId, TriageStatus, UserMark } from '../types'

/**
 * What the marker color shows: triage status, with "visited" winning over
 * new/shortlisted but not over rejected — the same precedence as statusColor,
 * so the Status filter reads exactly like the map.
 */
export type StatusFilter = TriageStatus | 'visited'

export function displayStatus(mark: UserMark | undefined): StatusFilter {
  if (mark?.status === 'rejected') return 'rejected'
  if (mark?.visited) return 'visited'
  return mark?.status ?? 'new'
}

export interface FilterState {
  /** Empty array = no restriction. */
  usage: string[]
  condition: string[]
  county: string[]
  status: StatusFilter[]
  minRating: number // 0 = any
  search: string
  /** Hint layers shown on the map (supplementary sources, leads only). */
  hints: HintSourceId[]
  /** ETAK noise cuts, 0 = off: min footprint m² / min distance to an in-use dwelling. */
  etakMinM2: number
  etakMinDwell: number
  /** UAS geographical zones drawn under the spots. */
  zones: boolean
  /**
   * Height in metres AGL the zones layer is judged against — a zone shows only
   * when its floor is below this. 120 is the open-category ceiling.
   */
  zoneCeiling: number
}

export const DEFAULT_FILTERS: FilterState = {
  usage: ['ei kasutata'],
  condition: ['halb'],
  county: [],
  // Rejected spots are hidden by default; tick "rejected" to review them.
  status: ['new', 'shortlisted', 'visited'],
  minRating: 0,
  search: '',
  hints: [],
  // Most ETAK ruins are sheds or on somebody's yard — both cuts default on,
  // tuned toward bigger buildings well clear of occupied yards.
  etakMinM2: 300,
  etakMinDwell: 200,
  zones: true,
  zoneCeiling: 120,
}

export function matchesFilters(b: Bando, f: FilterState, mark: UserMark | undefined): boolean {
  if (!f.status.includes(displayStatus(mark))) return false
  // Custom and community places carry no register attributes — only
  // status/rating/search apply.
  if (!b.custom && !b.community) {
    if (f.usage.length && !f.usage.includes(b.usage ?? '')) return false
    if (f.condition.length && !f.condition.includes(b.condition ?? '')) return false
    if (f.county.length && !f.county.includes(b.county)) return false
  }
  if (f.minRating > 0 && (mark?.rating ?? 0) < f.minRating) return false
  if (f.search) {
    const q = f.search.toLowerCase()
    const hay = `${b.name} ${b.address} ${b.municipality} ${b.county} ${mark?.comment ?? ''}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

/**
 * Every layer is driven from the Layers menu on the map, not from this panel,
 * so counting them would make the Filters badge claim a filter it can't show.
 */
const LAYER_KEYS: (keyof FilterState)[] = ['hints', 'etakMinM2', 'etakMinDwell', 'zones', 'zoneCeiling']

/** Count of filters that differ from the defaults, for the filter-button badge. */
export function activeFilterCount(f: FilterState): number {
  return (Object.keys(DEFAULT_FILTERS) as (keyof FilterState)[]).filter(
    (k) => !LAYER_KEYS.includes(k) && JSON.stringify(f[k]) !== JSON.stringify(DEFAULT_FILTERS[k]),
  ).length
}

/** Apply the user's manual corrections (Move fix, Edit field overrides), if any. */
export function resolveBando(b: Bando, mark: UserMark | undefined): Bando {
  if (!mark?.fix && !mark?.edits) return b
  let out = b
  if (mark.edits) {
    out = { ...out }
    for (const [key, value] of Object.entries(mark.edits)) {
      if (value != null) (out as unknown as Record<string, unknown>)[key] = value
    }
  }
  if (mark.fix) {
    // L-EST97 coords would be stale after a move — drop them (the detail view
    // recomputes them from the fixed WGS84 position).
    out = { ...out, lat: mark.fix.lat, lon: mark.fix.lon, lestX: undefined, lestY: undefined, geocode: 'manual' }
  }
  return out
}

export function placeToBando(p: CustomPlace): Bando {
  return {
    id: p.id,
    name: p.name,
    county: '',
    municipality: '',
    address: 'Custom place',
    lat: p.lat,
    lon: p.lon,
    geocode: 'manual',
    photos: [],
    custom: true,
    // Once this place is approved, mergeCommunity steps aside for the local copy
    // — so approved photos of it have to be picked up here, or the contributor
    // would be the one person who can't see them. Read rather than subscribed:
    // every caller recomputes when `bandos` changes, which is when community
    // data arrives.
    communityPhotos: useAppStore.getState().community?.photos?.[p.id],
  }
}

/**
 * Widen the active filters just enough that a freshly saved place shows up on
 * the map — a new place starts with triage status "new", so e.g. having "new"
 * unticked would otherwise make it invisible the moment it's created.
 * Returns true when the filters had to change.
 */
export function revealPlace(id: number): boolean {
  const { filters, setFilters } = useAppStore.getState()
  const { places, marks } = useMarksStore.getState()
  const place = places.find((p) => p.id === id)
  if (!place) return false
  const mark = marks[id]
  const b = resolveBando(placeToBando(place), mark)
  if (matchesFilters(b, filters, mark)) return false
  const patch: Partial<FilterState> = {}
  const status = displayStatus(mark)
  if (!filters.status.includes(status)) patch.status = [...filters.status, status]
  if (filters.minRating > 0 && (mark?.rating ?? 0) < filters.minRating) patch.minRating = 0
  // If it's still hidden after the relaxations above, the search box is the
  // only remaining reason a custom place can be filtered out.
  if (!matchesFilters(b, { ...filters, ...patch }, mark)) patch.search = ''
  setFilters(patch)
  return true
}

/** Dataset bandos + custom places, filtered. */
export function useFilteredBandos(): Bando[] {
  const bandos = useAppStore((s) => s.bandos)
  const filters = useAppStore((s) => s.filters)
  const marks = useMarksStore((s) => s.marks)
  const places = useMarksStore((s) => s.places)
  return useMemo(
    () =>
      [...bandos, ...places.map(placeToBando)]
        .map((b) => resolveBando(b, marks[b.id]))
        .filter((b) => matchesFilters(b, filters, marks[b.id])),
    [bandos, places, filters, marks],
  )
}
