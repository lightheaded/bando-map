import { useMemo } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { useFilteredBandos } from '../state/filters'
import { en, PHOTO_URL, type Bando, type TriageStatus } from '../types'

const STATUS_DOTS: Record<TriageStatus, string> = { new: '#e11d48', shortlisted: '#2563eb', rejected: '#71717a' }

/** Filtered bandos currently inside the map viewport, nearest to center first. */
export function useInViewBandos(): Bando[] {
  const bandos = useFilteredBandos()
  const view = useAppStore((s) => s.mapView)
  return useMemo(() => {
    if (!view) return bandos
    const [w, s, e, n] = view.bounds
    const [cx, cy] = view.center
    return bandos
      .filter((b) => b.lon >= w && b.lon <= e && b.lat >= s && b.lat <= n)
      .map((b) => ({ b, d: (b.lon - cx) ** 2 + (b.lat - cy) ** 2 }))
      .sort((a, z) => a.d - z.d)
      .map((x) => x.b)
  }, [bandos, view])
}

export function PlacesList() {
  const items = useInViewBandos()
  const select = useAppStore((s) => s.select)
  const marks = useMarksStore((s) => s.marks)

  return (
    <div className="places-list">
      <p className="list-count">
        {items.length} in view — zoom or pan to narrow
      </p>
      <ul>
        {items.map((b) => {
          const mark = marks[b.id]
          const status = mark?.status ?? 'new'
          const thumb = b.thumbs?.find(Boolean)
          return (
            <li key={b.id}>
              <button className="place-item" onClick={() => select(b.id)}>
                {thumb ? (
                  <img src={`${import.meta.env.BASE_URL}${thumb}`} alt="" loading="lazy" />
                ) : b.photos.length ? (
                  <img src={PHOTO_URL(b.photos[0])} alt="" loading="lazy" />
                ) : (
                  <span className="no-photo" aria-hidden="true">
                    {b.custom ? '★' : '▢'}
                  </span>
                )}
                <span className="place-text">
                  <span className="place-name">
                    <span className="dot" style={{ background: mark?.visited ? '#059669' : STATUS_DOTS[status] }} />
                    {b.name}
                  </span>
                  <span className="place-sub">
                    {b.custom ? 'Custom place' : `${b.address}, ${b.municipality}`}
                    {b.condition ? ` · ${en(b.condition)}` : ''}
                    {mark?.rating ? ` · ${'★'.repeat(mark.rating)}` : ''}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
