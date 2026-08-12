import { useMemo, useRef } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore, downloadUserData } from '../state/marks'
import { useFilteredBandos, activeFilterCount } from '../state/filters'
import { USAGE_VALUES, CONDITION_VALUES, EN, HINT_SOURCES, type HintSourceId } from '../types'
import { HINT_STYLE } from '../map/hints'
import type { StatusFilter } from '../state/filters'

export function FilterButton() {
  const open = useAppStore((s) => s.panel === 'filters')
  const togglePanel = useAppStore((s) => s.togglePanel)
  const filters = useAppStore((s) => s.filters)
  const count = useFilteredBandos().length
  const active = activeFilterCount(filters)
  return (
    <button
      className={`filter-button ${open ? 'active' : ''}`}
      onClick={() => togglePanel('filters')}
      aria-expanded={open}
    >
      Filters{active > 0 ? ` · ${active}` : ''} <span className="count">{count}</span>
    </button>
  )
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/**
 * Copies moved pins and field edits as a data/overrides.json snippet, so
 * corrections can flow back into the dataset.
 */
function CopyFixesButton() {
  const marks = useMarksStore((s) => s.marks)
  const showToast = useAppStore((s) => s.showToast)
  const fixes = Object.entries(marks).filter(([id, m]) => (m.fix || m.edits) && Number(id) > 0)
  if (!fixes.length) return null
  const copy = async () => {
    const overrides = Object.fromEntries(
      fixes.map(([id, m]) => [
        id,
        {
          ...(m.fix ? { lat: Number(m.fix.lat.toFixed(6)), lon: Number(m.fix.lon.toFixed(6)) } : {}),
          ...m.edits,
        },
      ]),
    )
    try {
      await navigator.clipboard.writeText(JSON.stringify(overrides, null, 2))
      showToast(`Copied ${fixes.length} fix(es) — paste into data/overrides.json and rerun the scrape`)
    } catch {
      showToast('Could not access the clipboard')
    }
  }
  return (
    <button className="btn btn-small" onClick={copy} title="Copy moved pins and edits as data/overrides.json content">
      Copy fixes ({fixes.length})
    </button>
  )
}

// Same colors and precedence as the map markers (see statusColor in MapView).
const STATUS_LABELS: Record<StatusFilter, string> = {
  new: 'New',
  shortlisted: 'Shortlisted',
  visited: 'Visited',
  rejected: 'Rejected',
}
const STATUS_DOTS: Record<StatusFilter, string> = {
  new: '#e11d48',
  shortlisted: '#2563eb',
  visited: '#059669',
  rejected: '#71717a',
}

export function FilterPanel() {
  const open = useAppStore((s) => s.panel === 'filters')
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
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
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
      <fieldset>
        <legend>Hint layers</legend>
        <div className="checks">
          {HINT_SOURCES.map((h: HintSourceId) => (
            <span key={h} style={{ display: 'contents' }}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={filters.hints.includes(h)}
                  onChange={() => setFilters({ hints: toggle(filters.hints, h) })}
                />
                <span className="dot" style={{ background: HINT_STYLE[h].color }} />
                {HINT_STYLE[h].label}
              </label>
              {h === 'etak' && filters.hints.includes('etak') && (
                <div className="hint-sub">
                  <label>
                    min footprint
                    <input
                      type="number"
                      min={0}
                      step={25}
                      value={filters.etakMinM2}
                      onChange={(e) => setFilters({ etakMinM2: Math.max(0, Number(e.target.value) || 0) })}
                    />
                    m²
                  </label>
                  <label>
                    min dwelling distance
                    <input
                      type="number"
                      min={0}
                      step={25}
                      value={filters.etakMinDwell}
                      onChange={(e) => setFilters({ etakMinDwell: Math.max(0, Number(e.target.value) || 0) })}
                    />
                    m
                  </label>
                  <span className="hint-sub-note">0 = off</span>
                </div>
              )}
            </span>
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
        <CopyFixesButton />
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
