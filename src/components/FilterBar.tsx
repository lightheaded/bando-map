import { useMemo, useRef } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore, downloadUserData } from '../state/marks'
import { useFilteredBandos, activeFilterCount } from '../state/filters'
import { USAGE_VALUES, CONDITION_VALUES, EN, type TriageStatus } from '../types'

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

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

const STATUS_LABELS: Record<TriageStatus, string> = { new: 'New', shortlisted: 'Shortlisted', rejected: 'Rejected' }
const STATUS_DOTS: Record<TriageStatus, string> = { new: '#e11d48', shortlisted: '#2563eb', rejected: '#71717a' }

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
      showToast(`Imported — ${merged} item(s) added or updated`)
    } catch (err) {
      showToast(`Import failed: ${err instanceof Error ? err.message : 'unreadable file'}`)
    }
  }

  return (
    <div className="filter-panel">
      <input
        type="search"
        placeholder="Search names, places, your notes…"
        value={filters.search}
        onChange={(e) => setFilters({ search: e.target.value })}
      />
      <fieldset>
        <legend>Status</legend>
        <div className="checks">
          {(Object.keys(STATUS_LABELS) as TriageStatus[]).map((s) => (
            <label key={s} className="checkbox">
              <input
                type="checkbox"
                checked={filters.status.includes(s)}
                onChange={() => setFilters({ status: toggle(filters.status, s) })}
              />
              <span className="dot" style={{ background: STATUS_DOTS[s] }} />
              {STATUS_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>
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
      <fieldset>
        <legend>Usage</legend>
        <div className="checks">
          {USAGE_VALUES.map((u) => (
            <label key={u} className="checkbox">
              <input
                type="checkbox"
                checked={filters.usage.includes(u)}
                onChange={() => setFilters({ usage: toggle(filters.usage, u) })}
              />
              {EN[u]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Condition</legend>
        <div className="checks">
          {CONDITION_VALUES.map((c) => (
            <label key={c} className="checkbox">
              <input
                type="checkbox"
                checked={filters.condition.includes(c)}
                onChange={() => setFilters({ condition: toggle(filters.condition, c) })}
              />
              {EN[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>County</legend>
        <div className="checks county-list">
          {counties.map((c) => (
            <label key={c} className="checkbox">
              <input
                type="checkbox"
                checked={filters.county.includes(c)}
                onChange={() => setFilters({ county: toggle(filters.county, c) })}
              />
              {c.replace(' maakond', '')}
            </label>
          ))}
        </div>
      </fieldset>
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
      <p className="legend-line">
        <span className="dot" style={{ background: '#e11d48' }} /> new
        <span className="dot" style={{ background: '#2563eb' }} /> shortlisted
        <span className="dot" style={{ background: '#059669' }} /> visited
        <span className="dot" style={{ background: '#71717a' }} /> rejected
      </p>
    </div>
  )
}
