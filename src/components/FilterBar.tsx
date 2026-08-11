import { useMemo, useRef } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore, downloadUserData } from '../state/marks'
import { useFilteredBandos, activeFilterCount } from '../state/filters'
import { USAGE_VALUES, CONDITION_VALUES } from '../types'

export function FilterButton() {
  const open = useAppStore((s) => s.filtersOpen)
  const setOpen = useAppStore((s) => s.setFiltersOpen)
  const filters = useAppStore((s) => s.filters)
  const count = useFilteredBandos().length
  const active = activeFilterCount(filters)
  return (
    <button className={`filter-button ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
      Filters{active > 0 ? ` · ${active}` : ''} <span className="count">{count}</span>
    </button>
  )
}

export function FilterPanel() {
  const open = useAppStore((s) => s.filtersOpen)
  const filters = useAppStore((s) => s.filters)
  const setFilters = useAppStore((s) => s.setFilters)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const bandos = useAppStore((s) => s.bandos)
  const importData = useMarksStore((s) => s.importData)
  const showToast = useAppStore((s) => s.showToast)
  const fileRef = useRef<HTMLInputElement>(null)

  const counties = useMemo(() => [...new Set(bandos.map((b) => b.county))].sort(), [bandos])

  if (!open) return null

  const onImportFile = async (file: File) => {
    try {
      const { merged } = importData(JSON.parse(await file.text()))
      showToast(`Imported — ${merged} mark(s) added or updated`)
    } catch (err) {
      showToast(`Import failed: ${err instanceof Error ? err.message : 'unreadable file'}`)
    }
  }

  return (
    <div className="filter-panel">
      <input
        type="search"
        placeholder="Search name or place…"
        value={filters.search}
        onChange={(e) => setFilters({ search: e.target.value })}
      />
      <label>
        Kasutus
        <select value={filters.usage} onChange={(e) => setFilters({ usage: e.target.value })}>
          <option value="any">kõik</option>
          {USAGE_VALUES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label>
        Seisukord
        <select value={filters.condition} onChange={(e) => setFilters({ condition: e.target.value })}>
          <option value="any">kõik</option>
          {CONDITION_VALUES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Maakond
        <select value={filters.county} onChange={(e) => setFilters({ county: e.target.value })}>
          <option value="any">kõik</option>
          {counties.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <div className="segmented" role="radiogroup" aria-label="Visited">
        {(['all', 'unvisited', 'visited'] as const).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={filters.visited === v}
            className={filters.visited === v ? 'active' : ''}
            onClick={() => setFilters({ visited: v })}
          >
            {v === 'all' ? 'All' : v === 'visited' ? 'Visited' : 'Unvisited'}
          </button>
        ))}
      </div>
      <label className="stars-filter">
        Min rating
        <span className="stars" role="radiogroup" aria-label="Minimum rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={filters.minRating === n}
              className={filters.minRating >= n ? 'star on' : 'star'}
              onClick={() => setFilters({ minRating: filters.minRating === n ? 0 : n })}
            >
              ★
            </button>
          ))}
        </span>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={filters.showHidden}
          onChange={(e) => setFilters({ showHidden: e.target.checked })}
        />
        Show hidden
      </label>
      <div className="filter-actions">
        <button className="btn btn-small" onClick={resetFilters}>
          Reset
        </button>
        <button className="btn btn-small" onClick={downloadUserData}>
          Export
        </button>
        <button className="btn btn-small" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportFile(f)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
