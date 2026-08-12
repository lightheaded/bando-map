import { useEffect, useState, type ReactNode } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { EditIcon, MapPinIcon, TrashIcon } from './icons'
import { placeToBando, resolveBando } from '../state/filters'
import { wgs84ToLest97 } from '../geo/lest97'
import {
  en,
  ICON,
  PERIOD_VALUES,
  USAGE_VALUES,
  CONDITION_VALUES,
  MUINAS_DETAIL_URL,
  PHOTO_URL,
  PDF_URL,
  GMAPS_URL,
  XGIS_URL,
  type Bando,
  type BandoEdits,
} from '../types'

/**
 * The triage buttons are color-coded checkbox toggles: outline when off, a
 * subtle fill when on. The checkbox is drawn by hand (styled via CSS off
 * aria-pressed) because the native one can't take the state colors.
 */
function ToggleButton({
  checked,
  color,
  title,
  onClick,
  children,
}: {
  checked: boolean
  color: 'shortlisted' | 'rejected' | 'visited'
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button className={`btn toggle-btn toggle-${color}`} title={title} aria-pressed={checked} onClick={onClick}>
      <span className="toggle-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
      {children}
    </button>
  )
}

function Chip({ value, className }: { value: string; className?: string }) {
  return (
    <span className={`chip ${className ?? ''}`}>
      {ICON[value] && <span className="chip-icon">{ICON[value]}</span>}
      {en(value)}
    </span>
  )
}

/**
 * Corrects the register fields in place. Only the fields that differ from the
 * dataset are stored (as `mark.edits`), so exports stay easy to merge back
 * into data/overrides.json. Custom places just get their name updated.
 */
function EditForm({ raw, item, onClose }: { raw: Bando; item: Bando; onClose: () => void }) {
  const setMark = useMarksStore((s) => s.setMark)
  const updatePlace = useMarksStore((s) => s.updatePlace)
  const showToast = useAppStore((s) => s.showToast)
  const hasEdits = useMarksStore((s) => !!s.marks[item.id]?.edits)
  const [draft, setDraft] = useState<Required<BandoEdits>>({
    name: item.name,
    address: item.address,
    period: item.period ?? '',
    usage: item.usage ?? '',
    condition: item.condition ?? '',
  })
  const patch = (p: Partial<BandoEdits>) => setDraft((d) => ({ ...d, ...p }))

  const save = () => {
    if (!draft.name.trim()) return
    if (item.custom) {
      updatePlace(item.id, { name: draft.name.trim() })
    } else {
      const edits: BandoEdits = {}
      if (draft.name.trim() !== raw.name) edits.name = draft.name.trim()
      if (draft.address.trim() !== raw.address) edits.address = draft.address.trim()
      if (draft.period && draft.period !== raw.period) edits.period = draft.period
      if (draft.usage && draft.usage !== raw.usage) edits.usage = draft.usage
      if (draft.condition && draft.condition !== raw.condition) edits.condition = draft.condition
      setMark(item.id, { edits: Object.keys(edits).length ? edits : undefined })
      showToast(
        Object.keys(edits).length
          ? 'Correction saved — submit it to the shared map from Contribute'
          : 'No changes from the register data',
      )
    }
    onClose()
  }

  const options = (values: readonly string[]) =>
    values.map((v) => (
      <option key={v} value={v}>
        {en(v)}
      </option>
    ))

  return (
    <div className="edit-form">
      <label>
        Name
        <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
      </label>
      {!item.custom && (
        <>
          <label>
            Address
            <input value={draft.address} onChange={(e) => patch({ address: e.target.value })} />
          </label>
          <div className="edit-selects">
            <label>
              Era
              <select value={draft.period} onChange={(e) => patch({ period: e.target.value })}>
                <option value="">—</option>
                {options(PERIOD_VALUES)}
              </select>
            </label>
            <label>
              Usage
              <select value={draft.usage} onChange={(e) => patch({ usage: e.target.value })}>
                <option value="">—</option>
                {options(USAGE_VALUES)}
              </select>
            </label>
            <label>
              Condition
              <select value={draft.condition} onChange={(e) => patch({ condition: e.target.value })}>
                <option value="">—</option>
                {options(CONDITION_VALUES)}
              </select>
            </label>
          </div>
        </>
      )}
      <div className="filter-actions">
        <button className="btn btn-small btn-primary" onClick={save}>
          Save
        </button>
        <button className="btn btn-small" onClick={onClose}>
          Cancel
        </button>
        {hasEdits && !item.custom && (
          <button
            className="btn btn-small btn-muted"
            onClick={() => {
              setMark(item.id, { edits: undefined })
              onClose()
            }}
          >
            Revert edits
          </button>
        )}
      </div>
    </div>
  )
}

const DELETE_REASONS = [
  'demolished',
  'nothing there',
  'duplicate',
  'not abandoned',
  "shouldn't be listed",
  'other',
] as const

/**
 * Takes a place off the map. A place that only exists on this device goes
 * immediately; anything on the shared map — register records, community spots,
 * places of yours that were approved — is queued as a deletion contribution
 * instead, with a reason the reviewer will judge it by.
 */
function DeleteForm({ item, shared, onClose }: { item: Bando; shared: boolean; onClose: () => void }) {
  const setMark = useMarksStore((s) => s.setMark)
  const removePlace = useMarksStore((s) => s.removePlace)
  const showToast = useAppStore((s) => s.showToast)
  const select = useAppStore((s) => s.select)
  const [reason, setReason] = useState<string>(DELETE_REASONS[0])
  const [detail, setDetail] = useState('')

  const confirm = () => {
    if (!shared) {
      removePlace(item.id)
      select(undefined)
      showToast('Place deleted')
      return
    }
    setMark(item.id, { remove: { reason: detail.trim() ? `${reason} — ${detail.trim()}` : reason } })
    showToast('Deletion queued — submit it to the shared map from Contribute')
    onClose()
  }

  return (
    <div className="edit-form delete-form">
      <h2>{item.name}</h2>
      {shared ? (
        <>
          <p className="offline-sub">
            Asks for this place to be taken off everyone's map. It stays on yours, tagged, until an admin approves.
          </p>
          <label>
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {DELETE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Details — optional, the reviewer sees this
            <input value={detail} maxLength={300} onChange={(e) => setDetail(e.target.value)} />
          </label>
        </>
      ) : (
        <p className="offline-sub">This place is only on this device — deleting it needs no review, and can't be undone.</p>
      )}
      <div className="filter-actions">
        <button className="btn btn-small btn-danger" onClick={confirm}>
          {shared ? 'Request deletion' : 'Delete place'}
        </button>
        <button className="btn btn-small" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function DetailContent() {
  const selectedId = useAppStore((s) => s.selectedId)
  const bando = useAppStore((s) => s.bandos.find((b) => b.id === s.selectedId))
  const place = useMarksStore((s) => (selectedId != null ? s.places.find((p) => p.id === selectedId) : undefined))
  const select = useAppStore((s) => s.select)
  const showToast = useAppStore((s) => s.showToast)
  const statusFilter = useAppStore((s) => s.filters.status)
  const communityPlaces = useAppStore((s) => s.community?.places)
  const mark = useMarksStore((s) => (selectedId != null ? s.marks[selectedId] : undefined))
  const setMark = useMarksStore((s) => s.setMark)
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setEditing(false)
    setDeleting(false)
    setComment(selectedId != null ? (useMarksStore.getState().marks[selectedId]?.comment ?? '') : '')
  }, [selectedId])

  const raw = bando ?? (place ? placeToBando(place) : undefined)
  const item = raw && resolveBando(raw, mark)
  if (selectedId == null || !item) return null

  const status = mark?.status
  // A custom place of the user's own is theirs to delete outright — unless it
  // was approved onto the shared map, where removing it needs review like any
  // register record or community spot.
  const shared = !item.custom || !!communityPlaces?.some((p) => p.id === item.id)
  const coords = `${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}`
  // Moved pins and custom places have no (fresh) dataset L-EST97 coordinates —
  // project them from WGS84 so the XGIS link always works.
  const lest =
    item.lestX != null && item.lestY != null ? { x: item.lestX, y: item.lestY } : wgs84ToLest97(item.lat, item.lon)

  const setStatus = (next: 'shortlisted' | 'rejected') => {
    const previous = status
    const value = status === next ? undefined : next
    const id = item.id
    setMark(id, { status: value })
    if (value === 'rejected' && !statusFilter.includes('rejected')) {
      select(undefined)
      showToast('Rejected — hidden from the map', {
        label: 'Undo',
        onClick: () => {
          setMark(id, { status: previous })
          select(id)
        },
      })
    }
  }

  return (
    <div className="detail-panel" aria-label={item.name}>
      <div className="detail-topbar">
        <button className="btn btn-small back" onClick={() => select(undefined)}>
          ← List
        </button>
        {mark?.remove ? (
          <button
            className="btn btn-small btn-iconed btn-danger btn-active"
            title="Keep this place on the map after all"
            onClick={() => {
              setMark(item.id, { remove: undefined })
              setDeleting(false)
              showToast('Deletion withdrawn')
            }}
          >
            <TrashIcon /> Undo delete
          </button>
        ) : (
          <button
            className={`btn btn-small btn-iconed btn-danger ${deleting ? 'btn-active' : ''}`}
            title={shared ? 'Ask for this place to be taken off the shared map' : 'Delete this place'}
            onClick={() => {
              setDeleting(!deleting)
              setEditing(false)
            }}
          >
            {deleting ? (
              'Cancel'
            ) : (
              <>
                <TrashIcon /> Delete
              </>
            )}
          </button>
        )}
        <button
          className={`btn btn-small btn-iconed ${editing ? 'btn-active' : ''}`}
          title="Correct this place's information"
          onClick={() => {
            setEditing(!editing)
            setDeleting(false)
          }}
        >
          {editing ? (
            'Cancel'
          ) : (
            <>
              <EditIcon /> Edit
            </>
          )}
        </button>
        <button
          className="btn btn-small btn-iconed"
          title="Correct this pin's position: click, then tap the map at the right spot"
          onClick={() => {
            useAppStore.getState().setMoveTarget(item.id)
            showToast('Tap the map at the correct location')
          }}
        >
          <MapPinIcon /> Move
        </button>
      </div>
      {deleting ? (
        <DeleteForm item={item} shared={shared} onClose={() => setDeleting(false)} />
      ) : editing ? (
        <EditForm raw={raw!} item={item} onClose={() => setEditing(false)} />
      ) : (
        <>
          <h2>{item.name}</h2>
          <p className="address">
            {item.custom
              ? 'Custom place'
              : item.community
                ? 'Community spot'
                : `${item.address}, ${item.municipality}, ${item.county}`}
          </p>
          <div className="chips">
            {item.period && <Chip value={item.period} />}
            {item.usage && <Chip value={item.usage} />}
            {item.condition && <Chip value={item.condition} className={item.condition === 'halb' ? 'chip-bad' : ''} />}
            {(item.geocode === 'street' || item.geocode === 'village') && (
              <span className="chip chip-warn" title="Coordinate is approximate — geocoded from an imprecise address">
                ~{item.geocode} accuracy
              </span>
            )}
            {item.custom && <span className="chip">📍 yours</span>}
            {item.community && <span className="chip">🌍 community</span>}
            {mark?.fix && <span className="chip">📌 moved</span>}
            {mark?.edits && <span className="chip">✏️ edited</span>}
            {mark?.remove && (
              <span className="chip chip-bad" title={`Deletion proposed: ${mark.remove.reason}`}>
                🗑️ deletion proposed
              </span>
            )}
          </div>
        </>
      )}
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
        {mark?.fix && (
          <button className="btn btn-small btn-muted" onClick={() => setMark(item.id, { fix: undefined })}>
            Reset pin
          </button>
        )}
      </div>
      <div className="mark-actions">
        <ToggleButton
          checked={status === 'shortlisted'}
          color="shortlisted"
          title="Looks worth a visit"
          onClick={() => setStatus('shortlisted')}
        >
          Shortlisted
        </ToggleButton>
        <ToggleButton
          checked={status === 'rejected'}
          color="rejected"
          title="Not a usable spot — hide it"
          onClick={() => setStatus('rejected')}
        >
          Rejected
        </ToggleButton>
        <ToggleButton
          checked={!!mark?.visited}
          color="visited"
          title="You were physically there"
          onClick={() =>
            setMark(item.id, {
              visited: !mark?.visited,
              visitedAt: !mark?.visited ? (mark?.visitedAt ?? new Date().toISOString().slice(0, 10)) : undefined,
            })
          }
        >
          Visited
        </ToggleButton>
        {mark?.visited && (
          <input
            type="date"
            className="visit-date"
            aria-label="Visit date"
            value={mark.visitedAt ?? ''}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setMark(item.id, { visitedAt: e.target.value || undefined })}
          />
        )}
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
        <a className="btn" href={XGIS_URL(lest.x, lest.y)} target="_blank" rel="noreferrer">
          XGIS
        </a>
        {!item.custom && !item.community && (
          <a className="btn" href={MUINAS_DETAIL_URL(item.id)} target="_blank" rel="noreferrer">
            muinas.ee
          </a>
        )}
        {item.pdf && (
          <a className="btn" href={PDF_URL(item.id)} target="_blank" rel="noreferrer" title="Register PDF (archived)">
            PDF
          </a>
        )}
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
    </div>
  )
}
