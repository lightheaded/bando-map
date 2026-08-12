/**
 * The Layers menu — everything drawn on the map besides the spots themselves,
 * in one place: the supplementary hint sources, and the UAS airspace zones.
 *
 * It lives on the map rather than in the sidebar because the sidebar is about
 * which *spots* you see, while these are about what else is painted around
 * them. The button that opens it only opens it: every layer is toggled by its
 * own checkbox here, so nothing appears or disappears from a stray click on
 * the control.
 *
 * Its position is measured from the button rather than hard-coded, so it stays
 * anchored if the controls above it ever change height.
 */
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { HINT_SOURCES, type HintSourceId } from '../types'
import { HINT_STYLE } from '../map/hints'
import {
  OPEN_CATEGORY_CEILING,
  STALE_AFTER_HOURS,
  ZONE_SEVERITY,
  isStale,
  relativeAge,
  type ZoneSeverity,
} from '../map/zones'

const OFFICIAL_URL = 'https://utm.eans.ee/avm/'

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export function LayersPopover() {
  const open = useAppStore((s) => s.layersPopover)
  const setOpen = useAppStore((s) => s.setLayersPopover)
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(150)

  // Sit just below the button that opened it.
  useEffect(() => {
    if (!open) return
    const button = document.querySelector('.map-layers-toggle')
    if (button) setTop(Math.round(button.getBoundingClientRect().bottom + 8))
  }, [open])

  // Click-away and Escape, the way every other transient popup here behaves.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      // The button runs its own toggle; let it, or the two would fight.
      if ((target as Element).closest?.('.map-layers-toggle')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="layers-popover" ref={ref} role="dialog" aria-label="Layers" style={{ top }}>
      <button type="button" className="layers-close" aria-label="Close" onClick={() => setOpen(false)}>
        ×
      </button>
      <HintLayers />
      <hr className="layers-divider" />
      <Airspace />
    </div>
  )
}

function HintLayers() {
  const filters = useAppStore((s) => s.filters)
  const setFilters = useAppStore((s) => s.setFilters)
  return (
    <section className="layers-section">
      <h3>Hint layers</h3>
      {HINT_SOURCES.map((h: HintSourceId) => (
        <div key={h}>
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
        </div>
      ))}
    </section>
  )
}

function Airspace() {
  const filters = useAppStore((s) => s.filters)
  const setFilters = useAppStore((s) => s.setFilters)
  const zoneData = useAppStore((s) => s.zoneData)
  const zoneState = useAppStore((s) => s.zoneState)
  const refreshZones = useAppStore((s) => s.refreshZones)

  const stale = isStale(zoneData?.checkedAt)
  const shown = zoneData?.features.filter((f) => f.properties.lower < filters.zoneCeiling).length

  return (
    <section className="layers-section">
      <h3>Airspace</h3>
      <label className="checkbox">
        <input type="checkbox" checked={filters.zones} onChange={() => setFilters({ zones: !filters.zones })} />
        <span className="dot" style={{ background: ZONE_SEVERITY.permission.color }} />
        UAS geographical zones
      </label>

      {filters.zones && (
        <>
          <label className="zone-ceiling">
            affects flight below
            <input
              type="number"
              min={1}
              max={3000}
              step={10}
              value={filters.zoneCeiling}
              onChange={(e) =>
                setFilters({
                  zoneCeiling: Math.min(3000, Math.max(1, Number(e.target.value) || OPEN_CATEGORY_CEILING)),
                })
              }
            />
            m AGL
          </label>
          <span className="hint-sub-note">
            {OPEN_CATEGORY_CEILING} m is the open-category ceiling
            {shown != null ? ` · ${shown} zones shown` : ''}
          </span>

          <ul className="zone-legend">
            {(Object.keys(ZONE_SEVERITY) as ZoneSeverity[]).map((s) => (
              <li key={s}>
                <span className="dot" style={{ background: ZONE_SEVERITY[s].color }} />
                <strong>{ZONE_SEVERITY[s].label}</strong> — {ZONE_SEVERITY[s].blurb}
              </li>
            ))}
          </ul>

          <div className="zone-freshness">
            <span className={stale ? 'stale' : undefined}>
              {zoneData ? `Checked ${relativeAge(zoneData.checkedAt)}` : 'Loading airspace…'}
            </span>
            <button
              type="button"
              className="btn btn-small"
              disabled={zoneState !== 'idle'}
              onClick={refreshZones}
              title="Ask the server to re-check the official source"
            >
              {zoneState === 'refreshing' ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {stale && zoneData && (
            <p className="zone-stale-warning">
              No successful check for over {STALE_AFTER_HOURS} hours — the hourly update has been failing, and a
              temporary danger area could have come or gone since. Refresh before you rely on it.
            </p>
          )}

          <p className="zone-disclaimer">
            A planning aid, not a preflight briefing. Always confirm on the{' '}
            <a href={OFFICIAL_URL} target="_blank" rel="noopener">
              official drone map
            </a>{' '}
            and check NOTAMs before you fly.
          </p>
        </>
      )}
    </section>
  )
}
