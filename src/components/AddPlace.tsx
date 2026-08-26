import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { revealPlace } from '../state/filters'
import { preparePhoto, type PreparedPhoto } from '../photos/prepare'
import { postPhoto } from '../sync/api'
import { refreshSubmissions } from '../state/contrib'
import { fmtBytes } from '../offline/storage'
import { useOnline } from './useOnline'
import { CameraIcon, TrashIcon } from './icons'

// The add flow starts from the map's + control or the Contribute panel's
// "+ Add a place" — both call toggleAddPlace, which puts the map in picking
// mode. A map tap sets the coordinates and opens this form.
/**
 * Picking mode says nothing on its own — the toast that starts it fades, and a
 * red button plus a crosshair cursor is thin evidence of what the map is now
 * waiting for. This card holds the instruction until a tap answers it, in the
 * slot the New place form takes over next.
 */
export function AddPlaceHint() {
  const picking = useAppStore((s) => s.placeDraft === 'picking')
  const setPlaceDraft = useAppStore((s) => s.setPlaceDraft)
  if (!picking) return null
  return (
    <div className="add-place-hint" role="status">
      <div>
        <strong>Adding a new place</strong>
        <span>Tap the map where the spot is.</span>
      </div>
      <button className="btn btn-small" onClick={() => setPlaceDraft(undefined)}>
        Cancel
      </button>
    </div>
  )
}

/**
 * Pictures chosen while the place is still being described. They are prepared
 * here and held until Save, because a photo has to name the place it is of and
 * the place has no id until then — the alternative is the old one, where the
 * first picture of a new spot waited out a whole review cycle.
 *
 * Preparing is the same browser-side downscale and re-encode the detail-panel
 * uploader uses (src/photos/prepare.ts), so the original's EXIF — the GPS tag
 * included — is gone before anything leaves the device.
 */
function PhotoPicker({
  photos,
  setPhotos,
  own,
  setOwn,
  disabled,
}: {
  photos: PreparedPhoto[]
  setPhotos: (next: PreparedPhoto[]) => void
  own: boolean
  setOwn: (next: boolean) => void
  disabled: boolean
}) {
  const showToast = useAppStore((s) => s.showToast)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    const added: PreparedPhoto[] = []
    for (const file of Array.from(files)) {
      try {
        added.push(await preparePhoto(file))
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'could not read that image')
      }
    }
    setPhotos([...photos, ...added])
    setBusy(false)
    // Let the same file be chosen again after a failure or a cancel.
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <div className="add-place-photos">
      {photos.length > 0 && (
        <ul className="photo-drafts">
          {photos.map((p, i) => (
            <li key={i}>
              <img
                src={`data:${p.ext === 'webp' ? 'image/webp' : 'image/jpeg'};base64,${p.thumb}`}
                alt={`Photo ${i + 1} of this place`}
              />
              <button
                className="btn btn-small btn-icon btn-danger"
                title="Remove this photo"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => setPhotos(photos.filter((_, n) => n !== i))}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn-small" disabled={busy || disabled} onClick={() => fileInput.current?.click()}>
        <CameraIcon />
        {busy ? 'Preparing…' : photos.length ? 'Add another photo' : 'Add photos'}
      </button>
      {photos.length > 0 && (
        <>
          <span className="offline-sub">
            {photos.length} photo{photos.length === 1 ? '' : 's'} ·{' '}
            {fmtBytes(photos.reduce((sum, p) => sum + p.bytes, 0))} · location data removed
          </span>
          <label className="checkbox">
            <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
            <span>I took these photos and agree they can be published here</span>
          </label>
        </>
      )}
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
    </div>
  )
}

export function AddPlaceForm() {
  const placeDraft = useAppStore((s) => s.placeDraft)
  const setPlaceDraft = useAppStore((s) => s.setPlaceDraft)
  const select = useAppStore((s) => s.select)
  const showToast = useAppStore((s) => s.showToast)
  const email = useAppStore((s) => s.sync.email)
  const addPlace = useMarksStore((s) => s.addPlace)
  const setMark = useMarksStore((s) => s.setMark)
  const online = useOnline()
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<PreparedPhoto[]>([])
  const [own, setOwn] = useState(false)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const open = typeof placeDraft === 'object'
  useEffect(() => {
    if (open) {
      setName('')
      setNotes('')
      setPhotos([])
      setOwn(false)
      nameRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  /**
   * Upload what was attached, one at a time, and say how many went live rather
   * than into the queue — an admin's uploads publish on arrival.
   * Returns the sentence to append to the toast, empty when nothing was added.
   */
  const sendPhotos = async (id: number, placeName: string): Promise<string> => {
    let sent = 0
    let live = 0
    for (const photo of photos) {
      try {
        const { submission } = await postPhoto({
          targetId: id,
          name: placeName,
          own: true,
          full: photo.full,
          thumb: photo.thumb,
        })
        sent++
        if (submission.status === 'approved') live++
      } catch {
        /* counted below by what is missing */
      }
    }
    await refreshSubmissions()
    if (!sent) return ' — the photos failed to upload, add them again from the place'
    const plural = sent === 1 ? '' : 's'
    const tail = live === sent ? `${sent} photo${plural} published` : `${sent} photo${plural} sent for review`
    return sent < photos.length ? ` — ${tail}, ${photos.length - sent} failed` : ` — ${tail}`
  }

  const save = async () => {
    // Enter in the name field reaches this too, where the disabled Save button
    // does not — an undeclared photo must not be dropped silently.
    if (!name.trim() || saving || (photos.length > 0 && !own)) {
      nameRef.current?.focus()
      return
    }
    const placeName = name.trim()
    setSaving(true)
    const id = addPlace({ name: placeName, lat: placeDraft.lat, lon: placeDraft.lon })
    if (notes.trim()) setMark(id, { comment: notes.trim() })
    const widened = revealPlace(id)
    // Uploads need the network; the place itself is already saved either way.
    const photoNote = photos.length ? await sendPhotos(id, placeName) : ''
    setPlaceDraft(undefined)
    setSaving(false)
    select(id)
    showToast(`Place added${widened ? ' — filters widened to show it' : ''}${photoNote}`)
  }

  // Photos ride to the review bucket over the network, under the contributor's
  // own account — without either, the place still saves, it just saves alone.
  const canUpload = !!email && online

  return (
    <div className="add-place-form" role="dialog" aria-label="Add place">
      <h3>New place</h3>
      <p className="coords-note">
        {placeDraft.lat.toFixed(6)}, {placeDraft.lon.toFixed(6)}
      </p>
      <p className="retap-note">Tap the map again to move the pin.</p>
      <input
        ref={nameRef}
        placeholder="Name *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <textarea
        placeholder="Your private notes (optional)"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {canUpload ? (
        <PhotoPicker photos={photos} setPhotos={setPhotos} own={own} setOwn={setOwn} disabled={saving} />
      ) : (
        <span className="offline-sub">
          {email ? 'Photos need a connection — add them later from the place.' : 'Sign in to add photos of this place.'}
        </span>
      )}
      <div className="filter-actions">
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={saving || (photos.length > 0 && !own)}
          title={photos.length > 0 && !own ? 'Confirm the photos are yours first' : undefined}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn" onClick={() => setPlaceDraft(undefined)} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}
