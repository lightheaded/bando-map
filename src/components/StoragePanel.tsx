import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
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
import { StorageIcon } from './icons'

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

export function StorageButton() {
  const open = useAppStore((s) => s.panel === 'storage')
  const togglePanel = useAppStore((s) => s.togglePanel)
  return (
    <button
      className={open ? 'active' : ''}
      onClick={() => togglePanel('storage')}
      aria-expanded={open}
      title="Storage used on this device"
    >
      <StorageIcon />
      Storage
    </button>
  )
}

/** What's stored on this device: usage bar, per-cache breakdown, persistence. */
export function StoragePanel() {
  const open = useAppStore((s) => s.panel === 'storage')
  const showToast = useAppStore((s) => s.showToast)
  const [stats, setStats] = useState<AllStats>()

  const refresh = () => loadStats().then(setStats)
  useEffect(() => {
    if (open) refresh()
  }, [open])

  if (!open) return null

  const clear = async (name: string, label: string) => {
    await clearCache(name)
    refresh()
    showToast(`${label} cleared`)
  }

  const pct = stats && stats.quota > 0 ? Math.max(1, Math.round((stats.usage / stats.quota) * 100)) : 0

  return (
    <div className="offline-panel">
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
              {stats.tiles.count > 0 && (
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
              {stats.photos.count > 0 && (
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
