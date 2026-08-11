import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { placeToBando } from '../state/filters'
import { en, MUINAS_DETAIL_URL, PHOTO_URL, GMAPS_URL, GMAPS_DIRECTIONS_URL, XGIS_URL } from '../types'

export function DetailPanel() {
  const selectedId = useAppStore((s) => s.selectedId)
  const bando = useAppStore((s) => s.bandos.find((b) => b.id === s.selectedId))
  const place = useMarksStore((s) => (selectedId != null ? s.places.find((p) => p.id === selectedId) : undefined))
  const select = useAppStore((s) => s.select)
  const showToast = useAppStore((s) => s.showToast)
  const statusFilter = useAppStore((s) => s.filters.status)
  const mark = useMarksStore((s) => (selectedId != null ? s.marks[selectedId] : undefined))
  const setMark = useMarksStore((s) => s.setMark)
  const removePlace = useMarksStore((s) => s.removePlace)
  const [copied, setCopied] = useState(false)
  const [comment, setComment] = useState('')

  useEffect(() => {
    setCopied(false)
    setComment(selectedId != null ? (useMarksStore.getState().marks[selectedId]?.comment ?? '') : '')
  }, [selectedId])

  const item = bando ?? (place ? placeToBando(place) : undefined)
  if (selectedId == null || !item) return null

  const status = mark?.status
  const coords = `${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}`
  const copyCoords = async () => {
    try {
      await navigator.clipboard.writeText(coords)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      showToast('Could not access the clipboard')
    }
  }

  const setStatus = (next: 'shortlisted' | 'rejected') => {
    const value = status === next ? undefined : next
    setMark(item.id, { status: value })
    if (value === 'rejected' && !statusFilter.includes('rejected')) {
      select(undefined)
      showToast('Rejected — tick "Rejected" in filters to review discarded spots')
    }
  }

  return (
    <aside className="detail-panel" aria-label={item.name}>
      <div className="grabber" aria-hidden="true" />
      <button className="close" onClick={() => select(undefined)} aria-label="Close">
        ×
      </button>
      <h2>{item.name}</h2>
      <p className="address">
        {item.custom ? 'Custom place' : `${item.address}, ${item.municipality}, ${item.county}`}
      </p>
      <div className="chips">
        {item.period && <span className="chip">{en(item.period)}</span>}
        {item.usage && <span className="chip">{en(item.usage)}</span>}
        {item.condition && (
          <span className={`chip ${item.condition === 'halb' ? 'chip-bad' : ''}`}>{en(item.condition)}</span>
        )}
        {!item.custom && item.geocode !== 'building' && (
          <span className="chip chip-warn" title="Coordinate is approximate — geocoded from an imprecise address">
            ~{item.geocode} accuracy
          </span>
        )}
        {item.custom && <span className="chip">yours</span>}
      </div>
      {item.photos.length > 0 && (
        <div className="photos">
          {item.photos.map((p, i) => (
            <a key={p} href={PHOTO_URL(p)} target="_blank" rel="noreferrer" title="Open full size">
              <img
                src={item.thumbs?.[i] ? `${import.meta.env.BASE_URL}${item.thumbs[i]}` : PHOTO_URL(p)}
                alt={item.name}
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
          className={`btn ${status === 'shortlisted' ? 'btn-shortlisted' : ''}`}
          title="Looks worth a visit"
          onClick={() => setStatus('shortlisted')}
        >
          {status === 'shortlisted' ? '♥ Shortlisted' : 'Shortlist'}
        </button>
        <button
          className={`btn ${status === 'rejected' ? 'btn-rejected' : ''}`}
          title="Not a usable spot — hide it"
          onClick={() => setStatus('rejected')}
        >
          {status === 'rejected' ? '✕ Rejected' : 'Reject'}
        </button>
        <button
          className={`btn ${mark?.visited ? 'btn-visited' : ''}`}
          title="You were physically there"
          onClick={() => setMark(item.id, { visited: !mark?.visited })}
        >
          {mark?.visited ? '⚑ Visited' : 'Visited?'}
        </button>
      </div>
      <div className="mark-actions">
        <span className="stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={mark?.rating === n}
              className={(mark?.rating ?? 0) >= n ? 'star on' : 'star'}
              onClick={() => setMark(item.id, { rating: mark?.rating === n ? undefined : (n as 1 | 2 | 3 | 4 | 5) })}
              title={`${n} star${n > 1 ? 's' : ''}`}
            >
              ★
            </button>
          ))}
        </span>
        {item.custom && (
          <button
            className="btn btn-small btn-muted"
            onClick={() => {
              removePlace(item.id)
              select(undefined)
              showToast('Place deleted')
            }}
          >
            Delete place
          </button>
        )}
      </div>
      <textarea
        className="comment"
        placeholder="Notes — lines, obstacles, access… (searchable)"
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onBlur={() => {
          if (comment !== (mark?.comment ?? '')) setMark(item.id, { comment: comment || undefined })
        }}
      />
      <div className="links">
        <a className="btn" href={GMAPS_URL(item.lat, item.lon)} target="_blank" rel="noreferrer">
          Google Maps
        </a>
        {item.lestX != null && item.lestY != null && (
          <a className="btn" href={XGIS_URL(item.lestX, item.lestY)} target="_blank" rel="noreferrer">
            XGIS
          </a>
        )}
        {!item.custom && (
          <a className="btn" href={MUINAS_DETAIL_URL(item.id)} target="_blank" rel="noreferrer">
            muinas.ee
          </a>
        )}
        <a className="btn btn-primary" href={GMAPS_DIRECTIONS_URL(item.lat, item.lon)} target="_blank" rel="noreferrer">
          Directions
        </a>
        <button
          className="btn"
          onClick={async () => {
            const url = location.href
            try {
              if (navigator.share) await navigator.share({ title: item.name, url })
              else {
                await navigator.clipboard.writeText(url)
                showToast('Link copied')
              }
            } catch {
              /* user cancelled the share sheet */
            }
          }}
        >
          Share
        </button>
      </div>
    </aside>
  )
}
