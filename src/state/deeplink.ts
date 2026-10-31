import { useEffect, useRef } from 'react'
import { useAppStore } from './store'
import { useMarksStore } from './marks'
import { HINT_SOURCES, type HintSourceId } from '../types'

/**
 * Shareable links:
 *   #b/<id>@<lat>,<lon>          — dataset bando or own custom place
 *   #h/<src>/<id>@<lat>,<lon>    — hint-layer spot (etak/osm/esap/teadaanded)
 *   #p/<lat>,<lon>[/<label>]     — dropped pin on any point, label URL-encoded
 * If a #b id exists it gets selected; otherwise the map zooms to the embedded
 * coordinates. A #h link also enables that hint layer if it's off, so the
 * receiver actually sees the spot. A #b link whose id is unknown here falls
 * back to a dropped pin at its coordinates.
 */
const HASH_RE = /^#b\/(-?\d+)(?:@(-?\d+\.?\d*),(-?\d+\.?\d*))?$/
const PIN_HASH_RE = /^#p\/(-?\d+\.?\d*),(-?\d+\.?\d*)(?:\/(.+))?$/
const HINT_HASH_RE = /^#h\/([a-z]+)\/([^@]+)@(-?\d+\.?\d*),(-?\d+\.?\d*)$/

/** Shareable hash for a dropped pin. */
export function pinHash(pin: { lat: number; lon: number; label?: string }): string {
  const label = pin.label ? `/${encodeURIComponent(pin.label)}` : ''
  return `#p/${pin.lat.toFixed(6)},${pin.lon.toFixed(6)}${label}`
}

function applyPinHash(hash: string): boolean {
  const p = hash.match(PIN_HASH_RE)
  if (!p) return false
  const lat = Number(p[1])
  const lon = Number(p[2])
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return true
  let label: string | undefined
  try {
    label = p[3] ? decodeURIComponent(p[3]).slice(0, 120) : undefined
  } catch {
    label = undefined
  }
  const { droppedPin, setDroppedPin } = useAppStore.getState()
  // The same link applies twice at start-up (on mount and once the dataset is
  // in); a second apply must not reopen the popup or move the map again.
  if (droppedPin && droppedPin.lat === lat && droppedPin.lon === lon && droppedPin.label === label) return true
  setDroppedPin({ lat, lon, label, fly: true })
  return true
}

function applyHash(hash: string) {
  if (applyPinHash(hash)) return
  const hint = hash.match(HINT_HASH_RE)
  if (hint && (HINT_SOURCES as readonly string[]).includes(hint[1])) {
    const src = hint[1] as HintSourceId
    const { filters, setFilters, setPendingHint } = useAppStore.getState()
    if (!filters.hints.includes(src)) setFilters({ hints: [...filters.hints, src] })
    setPendingHint({ src, id: decodeURIComponent(hint[2]), lat: Number(hint[3]), lon: Number(hint[4]) })
    return
  }
  const m = hash.match(HASH_RE)
  if (!m) return
  // Before the dataset arrives the initial-apply effect below handles the hash.
  if (!useAppStore.getState().bandos.length) return
  const id = Number(m[1])
  const { bandos, select, setDroppedPin, showToast } = useAppStore.getState()
  const exists = bandos.some((b) => b.id === id) || useMarksStore.getState().places.some((p) => p.id === id)
  if (exists) {
    select(id)
  } else if (m[2] && m[3]) {
    setDroppedPin({ lat: Number(m[2]), lon: Number(m[3]), fly: true })
    showToast('That spot is not in your dataset — showing its location')
  } else {
    showToast('That spot is not in your dataset')
  }
}

/**
 * Rewrite the hash to match the current selection, or else the dropped pin.
 * Also used when a hint popup closes.
 */
export function syncHashToSelection() {
  const { selectedId, bandos, droppedPin } = useAppStore.getState()
  const raw = bandos.find((b) => b.id === selectedId) ?? useMarksStore.getState().places.find((p) => p.id === selectedId)
  const fix = selectedId != null ? useMarksStore.getState().marks[selectedId]?.fix : undefined
  const item = raw && fix ? { ...raw, lat: fix.lat, lon: fix.lon } : raw
  if (item) {
    history.replaceState(null, '', `#b/${item.id}@${item.lat.toFixed(6)},${item.lon.toFixed(6)}`)
  } else if (droppedPin) {
    history.replaceState(null, '', pinHash(droppedPin))
  } else {
    history.replaceState(null, '', location.pathname + location.search)
  }
}

export function useDeepLink() {
  const bandos = useAppStore((s) => s.bandos)
  const selectedId = useAppStore((s) => s.selectedId)
  // Re-write the hash when the selected pin is moved with the Move tool.
  const fix = useMarksStore((s) => (selectedId != null ? s.marks[selectedId]?.fix : undefined))
  const droppedPin = useAppStore((s) => s.droppedPin)
  const ready = useRef(false)

  // The listener lives for the whole app lifetime — attaching it inside the
  // dataset-dependent effect below would get it removed by that effect's
  // cleanup when the dataset reference changes (e.g. StrictMode double-fetch).
  useEffect(() => {
    // A pin needs no dataset, so it shows at once, offline and before the
    // dataset download lands.
    applyPinHash(location.hash)
    const onHashChange = () => applyHash(location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Apply the incoming hash once the dataset is loaded.
  useEffect(() => {
    if (ready.current || !bandos.length) return
    ready.current = true
    applyHash(location.hash)
  }, [bandos])

  // Keep the URL shareable: selection writes the hash, deselection clears it.
  useEffect(() => {
    if (!ready.current) return
    syncHashToSelection()
  }, [selectedId, fix])

  // A pin that was just dropped or removed owns the hash, until the next
  // selection takes it over.
  const pinSeen = useRef(false)
  useEffect(() => {
    if (!pinSeen.current) {
      pinSeen.current = true
      return
    }
    if (droppedPin) history.replaceState(null, '', pinHash(droppedPin))
    else syncHashToSelection()
  }, [droppedPin])
}
