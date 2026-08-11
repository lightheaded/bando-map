import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { MUINAS_DETAIL_URL, PHOTO_URL, GMAPS_URL, GMAPS_DIRECTIONS_URL, XGIS_URL } from '../types'

export function DetailPanel() {
  const selectedId = useAppStore((s) => s.selectedId)
  const bando = useAppStore((s) => s.bandos.find((b) => b.id === s.selectedId))
  const select = useAppStore((s) => s.select)
  const showToast = useAppStore((s) => s.showToast)
  const showHidden = useAppStore((s) => s.filters.showHidden)
  const mark = useMarksStore((s) => (selectedId != null ? s.marks[selectedId] : undefined))
  const setMark = useMarksStore((s) => s.setMark)
  const [copied, setCopied] = useState(false)
  const [comment, setComment] = useState('')

  useEffect(() => {
    setCopied(false)
    setComment(selectedId != null ? (useMarksStore.getState().marks[selectedId]?.comment ?? '') : '')
  }, [selectedId])

  if (selectedId == null || !bando) return null

  const coords = `${bando.lat.toFixed(6)}, ${bando.lon.toFixed(6)}`
  const copyCoords = async () => {
    try {
      await navigator.clipboard.writeText(coords)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      showToast('Could not access the clipboard')
    }
  }

  return (
    <aside className="detail-panel" aria-label={bando.name}>
      <div className="grabber" aria-hidden="true" />
      <button className="close" onClick={() => select(undefined)} aria-label="Close">
        ×
      </button>
      <h2>{bando.name}</h2>
      <p className="address">
        {bando.address}, {bando.municipality}, {bando.county}
      </p>
      <div className="chips">
        {bando.period && <span className="chip">{bando.period}</span>}
        {bando.usage && <span className="chip">{bando.usage}</span>}
        {bando.condition && <span className={`chip ${bando.condition === 'halb' ? 'chip-bad' : ''}`}>{bando.condition}</span>}
        {bando.geocode !== 'building' && (
          <span className="chip chip-warn" title="Coordinate is approximate — geocoded from an imprecise address">
            ~{bando.geocode}
          </span>
        )}
      </div>
      {bando.photos.length > 0 && (
        <div className="photos">
          {bando.photos.map((p, i) => (
            <a key={p} href={PHOTO_URL(p)} target="_blank" rel="noreferrer" title="Open full size">
              <img
                src={i === 0 && bando.thumb ? `${import.meta.env.BASE_URL}${bando.thumb}` : PHOTO_URL(p)}
                alt={bando.name}
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
      <div className="coords-row">
        <code>{coords}</code>
        <button className={`btn btn-small ${copied ? 'btn-success' : ''}`} onClick={copyCoords}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <div className="mark-actions">
        <button
          className={`btn ${mark?.visited ? 'btn-visited' : ''}`}
          onClick={() => setMark(bando.id, { visited: !mark?.visited })}
        >
          {mark?.visited ? '✓ Visited' : 'Mark visited'}
        </button>
        <span className="stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={mark?.rating === n}
              className={(mark?.rating ?? 0) >= n ? 'star on' : 'star'}
              onClick={() => setMark(bando.id, { rating: mark?.rating === n ? undefined : (n as 1 | 2 | 3 | 4 | 5) })}
              title={`${n} star${n > 1 ? 's' : ''}`}
            >
              ★
            </button>
          ))}
        </span>
        <button
          className="btn btn-small btn-muted"
          onClick={() => {
            const hidden = !mark?.hidden
            setMark(bando.id, { hidden })
            if (hidden && !showHidden) {
              select(undefined)
              showToast('Hidden — enable "Show hidden" in filters to bring it back')
            }
          }}
        >
          {mark?.hidden ? 'Unhide' : 'Hide'}
        </button>
      </div>
      <textarea
        className="comment"
        placeholder="Notes — lines, obstacles, access…"
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onBlur={() => {
          if (comment !== (mark?.comment ?? '')) setMark(bando.id, { comment: comment || undefined })
        }}
      />
      <div className="links">
        <a className="btn" href={GMAPS_URL(bando.lat, bando.lon)} target="_blank" rel="noreferrer">
          Google Maps
        </a>
        {bando.lestX != null && bando.lestY != null && (
          <a className="btn" href={XGIS_URL(bando.lestX, bando.lestY)} target="_blank" rel="noreferrer">
            XGIS
          </a>
        )}
        <a className="btn" href={MUINAS_DETAIL_URL(bando.id)} target="_blank" rel="noreferrer">
          muinas.ee
        </a>
        <a className="btn btn-primary" href={GMAPS_DIRECTIONS_URL(bando.lat, bando.lon)} target="_blank" rel="noreferrer">
          Directions
        </a>
      </div>
    </aside>
  )
}
