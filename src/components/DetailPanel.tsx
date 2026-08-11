import { useAppStore } from '../state/store'
import { MUINAS_DETAIL_URL, PHOTO_URL, GMAPS_URL, GMAPS_DIRECTIONS_URL, XGIS_URL } from '../types'

export function DetailPanel() {
  const selectedId = useAppStore((s) => s.selectedId)
  const bando = useAppStore((s) => s.bandos.find((b) => b.id === s.selectedId))
  const select = useAppStore((s) => s.select)

  if (selectedId == null || !bando) return null

  const coords = `${bando.lat.toFixed(6)}, ${bando.lon.toFixed(6)}`
  return (
    <aside className="detail-panel">
      <button className="close" onClick={() => select(undefined)} aria-label="Close">
        ×
      </button>
      <h2>{bando.name}</h2>
      <p className="address">
        {bando.address}, {bando.municipality}, {bando.county}
      </p>
      <dl>
        {bando.period && (
          <>
            <dt>Periood</dt>
            <dd>{bando.period}</dd>
          </>
        )}
        <dt>Kasutus</dt>
        <dd>{bando.usage ?? '–'}</dd>
        <dt>Seisukord</dt>
        <dd>{bando.condition ?? '–'}</dd>
        <dt>Asukoht</dt>
        <dd>
          <button className="coords" onClick={() => navigator.clipboard.writeText(coords)} title="Copy coordinates">
            {coords} ⧉
          </button>
          {bando.geocode !== 'building' && <span className="precision-warning"> ~{bando.geocode} precision</span>}
        </dd>
      </dl>
      {bando.photos.length > 0 && (
        <div className="photos">
          {bando.photos.map((p) => (
            <a key={p} href={PHOTO_URL(p)} target="_blank" rel="noreferrer">
              <img src={PHOTO_URL(p)} alt={bando.name} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <p className="links">
        <a href={MUINAS_DETAIL_URL(bando.id)} target="_blank" rel="noreferrer">
          muinas.ee
        </a>
        <a href={GMAPS_URL(bando.lat, bando.lon)} target="_blank" rel="noreferrer">
          Google Maps
        </a>
        {bando.lestX != null && bando.lestY != null && (
          <a href={XGIS_URL(bando.lestX, bando.lestY)} target="_blank" rel="noreferrer">
            XGIS
          </a>
        )}
        <a href={GMAPS_DIRECTIONS_URL(bando.lat, bando.lon)} target="_blank" rel="noreferrer">
          Directions
        </a>
      </p>
    </aside>
  )
}
