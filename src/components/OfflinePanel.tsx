import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '../state/store'
import { BASE_LAYERS } from '../map/layers'
import { planAreaSave, downloadInto, MAX_SAVE_ZOOM, type SaveProgress } from '../offline/tiles'
import {
  CACHE_NAMES,
  cacheStats,
  clearCache,
  appShellBytes,
  storageEstimate,
  isPersisted,
  requestPersist,
  fmtBytes,
  type CacheStats,
} from '../offline/storage'

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine)

export function OfflineButton() {
  const open = useAppStore((s) => s.offlineOpen)
  const setOpen = useAppStore((s) => s.setOfflineOpen)
  const online = useOnline()
  return (
    <button
      className={`filter-button offline-button ${open ? 'active' : ''}`}
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      title="Offline maps & storage"
    >
      {online ? '⇣' : '⇣ offline'}
      {!online && <span className="offline-dot" aria-label="You are offline" />}
    </button>
  )
}

interface AllStats {
  tiles: CacheStats
  photos: CacheStats
  data: CacheStats
  app: number
  usage: number
  quota: number
  persisted: boolean
}

async function loadStats(): Promise<AllStats> {
  const [tiles, photos, data, app, est, persisted] = await Promise.all([
    cacheStats(CACHE_NAMES.tiles),
    cacheStats(CACHE_NAMES.photos),
    cacheStats(CACHE_NAMES.data),
    appShellBytes(),
    storageEstimate(),
    isPersisted(),
  ])
  return { tiles, photos, data, app, ...est, persisted }
}

export function OfflinePanel() {
  const open = useAppStore((s) => s.offlineOpen)
  const mapView = useAppStore((s) => s.mapView)
  const baseLayer = useAppStore((s) => s.baseLayer)
  const bandos = useAppStore((s) => s.bandos)
  const showToast = useAppStore((s) => s.showToast)
  const online = useOnline()

  const [stats, setStats] = useState<AllStats>()
  const [saving, setSaving] = useState<SaveProgress>()
  const [savingPhotos, setSavingPhotos] = useState<SaveProgress>()
  const abortRef = useRef<AbortController>(undefined)

  const refresh = () => loadStats().then(setStats)
  useEffect(() => {
    if (open) refresh()
    // Leaving the panel cancels a running download.
    if (!open) abortRef.current?.abort()
  }, [open])
  useEffect(() => () => abortRef.current?.abort(), [])

  if (!open) return null

  const plan = mapView ? planAreaSave(mapView.bounds, mapView.zoom, baseLayer) : undefined
  const thumbs = bandos.flatMap((b) => b.thumbs ?? []).filter((t): t is string => !!t)

  const saveArea = async () => {
    if (!plan || plan.tooBig) return
    abortRef.current = new AbortController()
    setSaving({ done: 0, total: plan.urls.length, bytes: 0, failed: 0 })
    const result = await downloadInto(CACHE_NAMES.tiles, plan.urls, setSaving, abortRef.current.signal)
    setSaving(undefined)
    refresh()
    if (abortRef.current.signal.aborted) showToast('Download cancelled — tiles saved so far are kept')
    else if (result.failed > 0) showToast(`Area saved with ${result.failed} failed tile(s) — try again to retry them`)
    else showToast(`Area saved for offline — ${fmtBytes(result.bytes)}`)
  }

  const savePhotos = async () => {
    abortRef.current = new AbortController()
    const urls = thumbs.map((t) => new URL(`${import.meta.env.BASE_URL}${t}`, location.href).href)
    setSavingPhotos({ done: 0, total: urls.length, bytes: 0, failed: 0 })
    const result = await downloadInto(CACHE_NAMES.photos, urls, setSavingPhotos, abortRef.current.signal)
    setSavingPhotos(undefined)
    refresh()
    if (!abortRef.current.signal.aborted) showToast(`Photos saved for offline — ${fmtBytes(result.bytes)}`)
  }

  const clear = async (name: string, label: string) => {
    await clearCache(name)
    refresh()
    showToast(`${label} cleared`)
  }

  const pct = stats && stats.quota > 0 ? Math.max(1, Math.round((stats.usage / stats.quota) * 100)) : 0

  return (
    <div className="offline-panel">
      <p className="offline-intro">
        Everything you browse is saved on this device and keeps working without signal. Heading somewhere remote? Save
        the area first.
      </p>

      <div className="offline-card">
        <div className="offline-card-head">
          <strong>Save this view</strong>
          <span className="offline-sub">
            {BASE_LAYERS[baseLayer]} layer · zoom {Math.floor(mapView?.zoom ?? 0)}–{MAX_SAVE_ZOOM}
          </span>
        </div>
        {saving ? (
          <>
            <Progress p={saving} />
            <button className="btn btn-small" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </>
        ) : plan?.tooBig ? (
          <p className="offline-sub">This view covers too many tiles to save at once — zoom in a bit first.</p>
        ) : (
          <div className="offline-row">
            <span className="offline-sub">
              {plan?.urls.length ?? 0} tiles · ~{fmtBytes(plan?.estBytes ?? 0)}
            </span>
            <button className="btn btn-small btn-primary" onClick={saveArea} disabled={!online || !plan}>
              {online ? 'Save area' : 'Offline'}
            </button>
          </div>
        )}
      </div>

      <div className="offline-card">
        <div className="offline-card-head">
          <strong>All spot photos</strong>
          <span className="offline-sub">
            {stats ? `${Math.min(stats.photos.count, thumbs.length)} of ${thumbs.length} saved` : `${thumbs.length} photos`}
          </span>
        </div>
        {savingPhotos ? (
          <Progress p={savingPhotos} />
        ) : (
          <div className="offline-row">
            <span className="offline-sub">{stats ? fmtBytes(stats.photos.bytes) : '…'}</span>
            <button
              className="btn btn-small"
              onClick={savePhotos}
              disabled={!online || (stats && stats.photos.count >= thumbs.length)}
            >
              {stats && stats.photos.count >= thumbs.length ? 'All saved ✓' : 'Save all'}
            </button>
          </div>
        )}
      </div>

      <div className="offline-storage">
        <div className="offline-card-head">
          <strong>Storage</strong>
          <span className="offline-sub">
            {stats ? `${fmtBytes(stats.usage)} of ${fmtBytes(stats.quota)}` : 'measuring…'}
          </span>
        </div>
        <div className="storage-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        {stats && (
          <ul className="storage-rows">
            <li>
              <span>Map tiles</span>
              <span className="offline-sub">
                {fmtBytes(stats.tiles.bytes)} · {stats.tiles.count} tiles
              </span>
              {stats.tiles.count > 0 && !saving && (
                <button className="btn btn-small btn-muted" onClick={() => clear(CACHE_NAMES.tiles, 'Map tiles')}>
                  Clear
                </button>
              )}
            </li>
            <li>
              <span>Photos</span>
              <span className="offline-sub">
                {fmtBytes(stats.photos.bytes)} · {stats.photos.count}
              </span>
              {stats.photos.count > 0 && !savingPhotos && (
                <button className="btn btn-small btn-muted" onClick={() => clear(CACHE_NAMES.photos, 'Photos')}>
                  Clear
                </button>
              )}
            </li>
            <li>
              <span>App & dataset</span>
              <span className="offline-sub">{fmtBytes(stats.app + stats.data.bytes)}</span>
            </li>
          </ul>
        )}
        {stats &&
          (stats.persisted ? (
            <p className="offline-sub persist-row">✓ Protected — the browser won't clean this up automatically</p>
          ) : (
            <div className="offline-row persist-row">
              <span className="offline-sub">Saved maps can be evicted when disk runs low</span>
              <button
                className="btn btn-small"
                onClick={async () => {
                  const granted = await requestPersist()
                  refresh()
                  showToast(granted ? 'Storage protected' : 'The browser declined — install the app to enable this')
                }}
              >
                Protect
              </button>
            </div>
          ))}
      </div>
    </div>
  )
}

function Progress({ p }: { p: SaveProgress }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
  return (
    <div className="offline-progress">
      <div className="storage-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="offline-sub">
        {p.done}/{p.total} · {fmtBytes(p.bytes)}
        {p.failed > 0 ? ` · ${p.failed} failed` : ''}
      </span>
    </div>
  )
}
