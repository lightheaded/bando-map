import { useEffect, useRef } from 'react'
import { useAppStore } from './store'
import { useMarksStore } from './marks'

/**
 * Shareable links: #b/<id>@<lat>,<lon>
 * If the id exists (dataset bando or own custom place) it gets selected;
 * otherwise the map zooms to the embedded coordinates.
 */
const HASH_RE = /^#b\/(-?\d+)(?:@(-?\d+\.?\d*),(-?\d+\.?\d*))?$/

function applyHash(hash: string) {
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

export function useDeepLink() {
  const bandos = useAppStore((s) => s.bandos)
  const selectedId = useAppStore((s) => s.selectedId)
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
    const item =
      useAppStore.getState().bandos.find((b) => b.id === selectedId) ??
      useMarksStore.getState().places.find((p) => p.id === selectedId)
    if (item) {
      history.replaceState(null, '', `#b/${item.id}@${item.lat.toFixed(6)},${item.lon.toFixed(6)}`)
    } else {
      history.replaceState(null, '', location.pathname + location.search)
    }
  }, [selectedId])
}
