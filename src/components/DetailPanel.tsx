import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
import { MUINAS_DETAIL_URL, PHOTO_URL, GMAPS_URL, GMAPS_DIRECTIONS_URL, XGIS_URL } from '../types'

export function DetailPanel() {
  const selectedId = useAppStore((s) => s.selectedId)
  const bando = useAppStore((s) => s.bandos.find((b) => b.id === s.selectedId))
  const select = useAppStore((s) => s.select)
  const showToast = useAppStore((s) => s.showToast)
  const [copied, setCopied] = useState(false)

  useEffect(() => setCopied(false), [selectedId])

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
          {bando.photos.map((p) => (
            <a key={p} href={PHOTO_URL(p)} target="_blank" rel="noreferrer" title="Open full size">
              <img src={PHOTO_URL(p)} alt={bando.name} loading="lazy" />
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
