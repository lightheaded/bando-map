import { useMemo } from 'react'
import { useAppStore } from './store'
import { useMarksStore } from './marks'
import type { Bando, CustomPlace, TriageStatus, UserMark } from '../types'

export interface FilterState {
  /** Empty array = no restriction. */
  usage: string[]
  condition: string[]
  county: string[]
  status: TriageStatus[]
  visited: 'all' | 'visited' | 'unvisited'
  minRating: number // 0 = any
  search: string
}

export const DEFAULT_FILTERS: FilterState = {
  usage: ['ei kasutata'],
  condition: ['halb'],
  county: [],
  // Rejected spots are hidden by default; tick "rejected" to review them.
  status: ['new', 'shortlisted'],
  visited: 'all',
  minRating: 0,
  search: '',
}

export function matchesFilters(b: Bando, f: FilterState, mark: UserMark | undefined): boolean {
  const status: TriageStatus = mark?.status ?? 'new'
  if (!f.status.includes(status)) return false
  // Custom places carry no register attributes — only status/visited/rating/search apply.
  if (!b.custom) {
    if (f.usage.length && !f.usage.includes(b.usage ?? '')) return false
    if (f.condition.length && !f.condition.includes(b.condition ?? '')) return false
    if (f.county.length && !f.county.includes(b.county)) return false
  }
  if (f.visited === 'visited' && !mark?.visited) return false
  if (f.visited === 'unvisited' && mark?.visited) return false
  if (f.minRating > 0 && (mark?.rating ?? 0) < f.minRating) return false
  if (f.search) {
    const q = f.search.toLowerCase()
    const hay = `${b.name} ${b.address} ${b.municipality} ${b.county} ${mark?.comment ?? ''}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

/** Count of filters that differ from the defaults, for the filter-button badge. */
export function activeFilterCount(f: FilterState): number {
  return (Object.keys(DEFAULT_FILTERS) as (keyof FilterState)[]).filter(
    (k) => JSON.stringify(f[k]) !== JSON.stringify(DEFAULT_FILTERS[k]),
  ).length
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
  }
}

/** Dataset bandos + custom places, filtered. */
export function useFilteredBandos(): Bando[] {
  const bandos = useAppStore((s) => s.bandos)
  const filters = useAppStore((s) => s.filters)
  const marks = useMarksStore((s) => s.marks)
  const places = useMarksStore((s) => s.places)
  return useMemo(
    () => [...bandos, ...places.map(placeToBando)].filter((b) => matchesFilters(b, filters, marks[b.id])),
    [bandos, places, filters, marks],
  )
}
