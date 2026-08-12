import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { BASE_LAYERS } from '../map/layers'
import { planAreaSave, downloadInto, MAX_SAVE_ZOOM, type SaveProgress } from '../offline/tiles'
import { CACHE_NAMES, cacheStats, fmtBytes, type CacheStats } from '../offline/storage'
import { useOnline } from './useOnline'
import { DownloadIcon } from './icons'
import { COMMUNITY_PHOTO_URL } from '../types'

export function OfflineButton() {
  const open = useAppStore((s) => s.panel === 'offline')
  const togglePanel = useAppStore((s) => s.togglePanel)
  const online = useOnline()
  return (
    <button
      className={open ? 'active' : ''}
      onClick={() => togglePanel('offline')}
      aria-expanded={open}
      title="Download maps & photos for offline use"
    >
      <DownloadIcon />
      Downloads
      {!online && <span className="offline-dot" aria-label="You are offline" />}
    </button>
  )
}

/** Save-for-offline downloads: the current map view and all spot photos. */
export function OfflinePanel() {
  const open = useAppStore((s) => s.panel === 'offline')
  const mapView = useAppStore((s) => s.mapView)
  const mapZoom = useAppStore((s) => s.mapZoom)
  const baseLayer = useAppStore((s) => s.baseLayer)
  const bandos = useAppStore((s) => s.bandos)
  const thumbsBytes = useAppStore((s) => s.thumbsBytes)
  const showToast = useAppStore((s) => s.showToast)
  const online = useOnline()

  const [photoStats, setPhotoStats] = useState<CacheStats>()
  const [saving, setSaving] = useState<SaveProgress>()
  const [savingPhotos, setSavingPhotos] = useState<SaveProgress>()
  const abortRef = useRef<AbortController>(undefined)

  const refresh = () => cacheStats(CACHE_NAMES.photos).then(setPhotoStats)
  useEffect(() => {
    if (open) refresh()
    // Leaving the panel cancels a running download.
    if (!open) abortRef.current?.abort()
  }, [open])
  useEffect(() => () => abortRef.current?.abort(), [])

  if (!open) return null

  const plan = mapView ? planAreaSave(mapView.bounds, mapView.zoom, baseLayer) : undefined
  // Register thumbnails (relative to the app base) and contributed ones (absolute,
  // straight off the CDN) go into one list, so "download all" means all of them.
  const contributed = bandos.flatMap((b) => b.communityPhotos ?? [])
  const thumbs = [
    ...bandos
      .flatMap((b) => b.thumbs ?? [])
      .filter((t): t is string => !!t)
      .map((t) => new URL(`${import.meta.env.BASE_URL}${t}`, location.href).href),
    ...contributed.map((token) => COMMUNITY_PHOTO_URL(token, 'thumb')),
  ]
  // The dataset states its own thumbnail total; contributed ones are all the same
  // 480px render, so ~30 KB apiece is close enough to state up front.
  const photoBytes = (thumbsBytes ?? (thumbs.length - contributed.length) * 30_000) + contributed.length * 30_000

  const saveArea = async () => {
    if (!plan || plan.tooBig) return
    abortRef.current = new AbortController()
    setSaving({ done: 0, total: plan.urls.length, bytes: 0, failed: 0 })
    const result = await downloadInto(CACHE_NAMES.tiles, plan.urls, setSaving, abortRef.current.signal)
    setSaving(undefined)
    if (abortRef.current.signal.aborted) showToast('Download cancelled — tiles downloaded so far are kept')
    else if (result.failed > 0)
      showToast(`Area downloaded with ${result.failed} failed tile(s) — try again to retry them`)
    else showToast(`Area downloaded for offline use — ${fmtBytes(result.bytes)}`)
  }

  const savePhotos = async () => {
    abortRef.current = new AbortController()
    setSavingPhotos({ done: 0, total: thumbs.length, bytes: 0, failed: 0 })
    const result = await downloadInto(CACHE_NAMES.photos, thumbs, setSavingPhotos, abortRef.current.signal)
    setSavingPhotos(undefined)
    refresh()
    if (!abortRef.current.signal.aborted) showToast(`Photos downloaded for offline use — ${fmtBytes(result.bytes)}`)
  }

  return (
    <div className="offline-panel">
      <p className="offline-intro">
        Everything you browse is saved on this device and keeps working offline. Heading somewhere remote? Download
        the area first.
      </p>

      <div className="offline-card">
        <div className="offline-card-head">
          <strong>Download for offline use</strong>
          <span className="offline-sub">
            {BASE_LAYERS[baseLayer]} layer · current zoom {(mapZoom ?? mapView?.zoom ?? 0).toFixed(1)}
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
          <>
            <div className="offline-row">
              <span className="offline-sub">
                {plan?.urls.length ?? 0} tiles · ~{fmtBytes(plan?.estBytes ?? 0)}
                {plan && ` · zoom ${plan.zFrom}–${plan.zTo}`}
              </span>
              <button className="btn btn-small btn-primary" onClick={saveArea} disabled={!online || !plan}>
                {online ? 'Download area' : 'No connection'}
              </button>
            </div>
            {plan && plan.zTo < MAX_SAVE_ZOOM && (
              <p className="offline-sub">
                Large area — downloaded down to zoom {plan.zTo}. Zoom the map in for street-level detail.
              </p>
            )}
          </>
        )}
      </div>

      <div className="offline-card">
        <div className="offline-card-head">
          <strong>All spot photos</strong>
          <span className="offline-sub">
            {thumbs.length} photos ·{' '}
            {/* Exact only when the dataset stated its own total and no
                contributed photo is in the count — those are estimated. */}
            {thumbsBytes && !contributed.length ? fmtBytes(photoBytes) : `~${fmtBytes(photoBytes)}`}
          </span>
        </div>
        {savingPhotos ? (
          <Progress p={savingPhotos} />
        ) : (
          <div className="offline-row">
            <span className="offline-sub">
              {photoStats
                ? photoStats.count >= thumbs.length
                  ? `all downloaded · ${fmtBytes(photoStats.bytes)}`
                  : `${Math.min(photoStats.count, thumbs.length)} downloaded so far · ${fmtBytes(photoStats.bytes)}`
                : '…'}
            </span>
            <button
              className="btn btn-small"
              onClick={savePhotos}
              disabled={!online || (photoStats && photoStats.count >= thumbs.length)}
            >
              {photoStats && photoStats.count >= thumbs.length ? 'All downloaded ✓' : 'Download all'}
            </button>
          </div>
        )}
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
