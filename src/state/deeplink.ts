import { useEffect, useRef } from 'react'
import { useAppStore } from './store'
import { useMarksStore } from './marks'
import { HINT_SOURCES, type HintSourceId } from '../types'

/**
 * Shareable links:
 *   #b/<id>@<lat>,<lon>          — dataset bando or own custom place
 *   #h/<src>/<id>@<lat>,<lon>    — hint-layer spot (etak/osm/esap/teadaanded)
 * If a #b id exists it gets selected; otherwise the map zooms to the embedded
 * coordinates. A #h link also enables that hint layer if it's off, so the
 * receiver actually sees the spot.
 */
const HASH_RE = /^#b\/(-?\d+)(?:@(-?\d+\.?\d*),(-?\d+\.?\d*))?$/
const HINT_HASH_RE = /^#h\/([a-z]+)\/([^@]+)@(-?\d+\.?\d*),(-?\d+\.?\d*)$/

function applyHash(hash: string) {
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
  const { bandos, select, setPendingView, showToast } = useAppStore.getState()
  const exists = bandos.some((b) => b.id === id) || useMarksStore.getState().places.some((p) => p.id === id)
  if (exists) {
    select(id)
  } else if (m[2] && m[3]) {
    setPendingView({ lat: Number(m[2]), lon: Number(m[3]) })
    showToast('That spot is not in your dataset — showing its location')
  } else {
    showToast('That spot is not in your dataset')
  }
}

/** Rewrite the hash to match the current selection — also used when a hint popup closes. */
export function syncHashToSelection() {
  const { selectedId, bandos } = useAppStore.getState()
  const raw = bandos.find((b) => b.id === selectedId) ?? useMarksStore.getState().places.find((p) => p.id === selectedId)
  const fix = selectedId != null ? useMarksStore.getState().marks[selectedId]?.fix : undefined
  const item = raw && fix ? { ...raw, lat: fix.lat, lon: fix.lon } : raw
  if (item) {
    history.replaceState(null, '', `#b/${item.id}@${item.lat.toFixed(6)},${item.lon.toFixed(6)}`)
  } else {
    history.replaceState(null, '', location.pathname + location.search)
  }
}

export function useDeepLink() {
  const bandos = useAppStore((s) => s.bandos)
  const selectedId = useAppStore((s) => s.selectedId)
  // Re-write the hash when the selected pin is moved with the Move tool.
  const fix = useMarksStore((s) => (selectedId != null ? s.marks[selectedId]?.fix : undefined))
  const ready = useRef(false)

  // The listener lives for the whole app lifetime — attaching it inside the
  // dataset-dependent effect below would get it removed by that effect's
  // cleanup when the dataset reference changes (e.g. StrictMode double-fetch).
  useEffect(() => {
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
}
