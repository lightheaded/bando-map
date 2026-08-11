import { useMemo } from 'react'
import { useAppStore } from './store'
import { useMarksStore } from './marks'
import type { Bando, UserMark } from '../types'

export interface FilterState {
  usage: string // exact value or 'any'
  condition: string
  county: string
  visited: 'all' | 'visited' | 'unvisited'
  minRating: number // 0 = any
  search: string
  showHidden: boolean
}

export const DEFAULT_FILTERS: FilterState = {
  usage: 'ei kasutata',
  condition: 'halb',
  county: 'any',
  visited: 'all',
  minRating: 0,
  search: '',
  showHidden: false,
}

export function matchesFilters(b: Bando, f: FilterState, mark: UserMark | undefined): boolean {
  if (!f.showHidden && mark?.hidden) return false
  if (f.usage !== 'any' && b.usage !== f.usage) return false
  if (f.condition !== 'any' && b.condition !== f.condition) return false
  if (f.county !== 'any' && b.county !== f.county) return false
  if (f.visited === 'visited' && !mark?.visited) return false
  if (f.visited === 'unvisited' && mark?.visited) return false
  if (f.minRating > 0 && (mark?.rating ?? 0) < f.minRating) return false
  if (f.search) {
    const q = f.search.toLowerCase()
    const hay = `${b.name} ${b.address} ${b.municipality} ${b.county}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

/** Count of filters that differ from the defaults, for the filter-button badge. */
export function activeFilterCount(f: FilterState): number {
  return (Object.keys(DEFAULT_FILTERS) as (keyof FilterState)[]).filter((k) => f[k] !== DEFAULT_FILTERS[k]).length
}

export function useFilteredBandos(): Bando[] {
  const bandos = useAppStore((s) => s.bandos)
  const filters = useAppStore((s) => s.filters)
  const marks = useMarksStore((s) => s.marks)
  return useMemo(() => bandos.filter((b) => matchesFilters(b, filters, marks[b.id])), [bandos, filters, marks])
}
