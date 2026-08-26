import { useEffect, useMemo, useState } from 'react'
import { toggleAddPlace, useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { useContribStore, useLocalChanges, refreshSubmissions, type LocalChange } from '../state/contrib'
import { deletePhoto, postSubmission } from '../sync/api'
import { syncEnabled } from '../sync/config'
import { signIn } from '../sync/auth'
import { useOnline } from './useOnline'
import { CameraIcon, EditIcon, MapPinIcon, TrashIcon } from './icons'
import type { Submission, SubmissionData } from '../types'

export function ContributeButton() {
  const open = useAppStore((s) => s.panel === 'contribute')
  const togglePanel = useAppStore((s) => s.togglePanel)
  const count = useLocalChanges().length
  return (
    <button
      className={open ? 'active' : ''}
      onClick={() => togglePanel('contribute')}
      aria-expanded={open}
      title="Contribute your changes to the shared map"
    >
      <EditIcon />
      Contribute
      {count > 0 && <span className="tab-badge">{count}</span>}
    </button>
  )
}

export function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days > 0) return `${days} d`
  const hours = Math.floor(ms / 3_600_000)
  return hours > 0 ? `${hours} h` : 'just now'
}

/**
 * What a submission asked for — a status chip says how it went, but not what
 * "it" was, and a name alone can't tell an added place from a deleted one.
 */
const KINDS = {
  place: { Icon: MapPinIcon, label: 'Place you added' },
  edit: { Icon: EditIcon, label: 'Correction you submitted' },
  delete: { Icon: TrashIcon, label: 'Deletion you asked for' },
  photo: { Icon: CameraIcon, label: 'Photo you uploaded' },
} as const

function KindIcon({ type }: { type: SubmissionData['type'] }) {
  const { Icon, label } = KINDS[type] ?? KINDS.edit
  return (
    <span className={`sub-kind sub-kind-${type}`} title={label} role="img" aria-label={label}>
      <Icon />
    </span>
  )
}

function StatusChip({ s }: { s: Submission }) {
  if (s.status === 'pending') return <span className="sub-status pending">pending · {age(s.createdAt)}</span>
  if (s.status === 'approved') return <span className="sub-status approved">✓ live</span>
  return <span className="sub-status rejected">✕ {s.reason}</span>
}

/**
 * Drop one row of "Your changes" — what that means depends on what the row is.
 * A place of your own is the change, so it goes; a correction is reverted to
 * the shared map's values; a queued deletion is withdrawn. Nothing here has
 * left the device yet, so every one of them is undoable from the toast.
 */
function useDiscardChange(): (c: LocalChange) => void {
  const showToast = useAppStore((s) => s.showToast)
  const select = useAppStore((s) => s.select)

  return (c: LocalChange) => {
    const { marks, places, setMark, removePlace, restorePlace } = useMarksStore.getState()
    const mark = marks[c.targetId]
    if (c.type === 'place') {
      const place = places.find((p) => p.id === c.targetId)
      if (!place) return
      if (useAppStore.getState().selectedId === c.targetId) select(undefined)
      removePlace(c.targetId)
      showToast(`Deleted "${place.name}"`, { label: 'Undo', onClick: () => restorePlace(place, mark) })
      return
    }
    if (c.type === 'delete') {
      setMark(c.targetId, { remove: undefined })
      showToast('Deletion withdrawn', {
        label: 'Undo',
        onClick: () => setMark(c.targetId, { remove: mark?.remove }),
      })
      return
    }
    setMark(c.targetId, { fix: undefined, edits: undefined })
    showToast('Correction reverted', {
      label: 'Undo',
      onClick: () => setMark(c.targetId, { fix: mark?.fix, edits: mark?.edits }),
    })
  }
}

/** What the trash button on a row does, spelled out before it is pressed. */
const DISCARD_LABEL = {
  place: 'Delete this place',
  edit: 'Revert this correction',
  delete: 'Withdraw this deletion request',
} as const

/**
 * Community sourcing: add a place, review what you've changed locally, submit
 * it for admin approval, and follow what happened to past submissions —
 * always with a visible status and a reason on rejections, never a black
 * hole. Personal state (shortlist, visits, ratings, notes) is not shareable
 * and never shows up here.
 */
export function ContributePanel() {
  const open = useAppStore((s) => s.panel === 'contribute')
  const placeDraft = useAppStore((s) => s.placeDraft)
  const showToast = useAppStore((s) => s.showToast)
  const email = useAppStore((s) => s.sync.email)
  // An admin's own contributions skip the queue — the panel must not promise a
  // review that will not happen.
  const admin = useAppStore((s) => s.sync.admin)
  const changes = useLocalChanges()
  const submissions = useContribStore((s) => s.submissions)
  const online = useOnline()
  const select = useAppStore((s) => s.select)
  const discard = useDiscardChange()
  const dropCommunityPhoto = useAppStore((s) => s.dropCommunityPhoto)
  const bandos = useAppStore((s) => s.bandos)
  const places = useMarksStore((s) => s.places)
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /** Deleting a photo cannot be undone anywhere, so the trash arms and a second press confirms. */
  const [confirmPhoto, setConfirmPhoto] = useState<string>()
  const [deletingPhoto, setDeletingPhoto] = useState(false)

  // A submission whose target left the map — an approved deletion, or a place
  // added on another device — has nothing to open, so its row does not offer to.
  const onMap = useMemo(
    () => new Set([...bandos.map((b) => b.id), ...places.map((p) => p.id)]),
    [bandos, places],
  )

  useEffect(() => {
    if (open && email) refreshSubmissions()
  }, [open, email])

  if (!open) return null

  // Picking a spot or filling the form that follows it — both are "adding",
  // and both are cancelled by the same button.
  const adding = placeDraft != null
  const selected = changes.filter((c) => !excluded.has(c.targetId))

  const removePhoto = async (s: Submission) => {
    setDeletingPhoto(true)
    try {
      await deletePhoto(s.id)
      // A published one is behind a CDN invalidation, so take it off this
      // device's map straight away rather than waiting for the rebuilt file.
      if (s.status === 'approved' && s.data.photo) dropCommunityPhoto(s.data.targetId, s.data.photo.file)
      setConfirmPhoto(undefined)
      showToast('Photo deleted')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Deleting the photo failed')
    } finally {
      await refreshSubmissions()
      setDeletingPhoto(false)
    }
  }

  const toggleRow = (id: number) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async () => {
    setSubmitting(true)
    let sent = 0
    let live = 0
    try {
      // One atomic submission per place, so a rejection never drags down
      // unrelated good edits.
      for (const c of selected) {
        const { submission } = await postSubmission({
          type: c.type,
          targetId: c.targetId,
          name: c.name,
          before: c.before,
          after: c.after,
          // A deletion carries its own reason; the panel's note adds to it.
          note: [c.note, note.trim()].filter(Boolean).join(' — ') || undefined,
        })
        sent++
        if (submission.status === 'approved') live++
      }
      setNote('')
      const plural = sent === 1 ? '' : 's'
      showToast(live === sent ? `Published ${sent} change${plural}` : `Submitted ${sent} change${plural} for review`)
    } catch {
      showToast(sent ? `Sent ${sent}, then failed — try again for the rest` : 'Submitting failed — try again')
    } finally {
      await refreshSubmissions()
      setSubmitting(false)
    }
  }

  return (
    <div className="offline-panel">
      <div className="offline-card">
        <div className="offline-card-head">
          <strong>Help build the map</strong>
        </div>
        <p className="offline-sub contrib-pitch">
          Bando Map is community-sourced: move mispinned spots, fix wrong details, add missing places, add your own
          photos from a place's detail view.{' '}
          {admin
            ? 'You review contributions, so your own changes publish straight to the map.'
            : 'Submit your changes for review — approved ones go live on everyone\u2019s map.'}
        </p>
        <button className={`btn btn-small ${adding ? 'btn-active' : ''}`} onClick={toggleAddPlace}>
          {adding ? 'Cancel adding' : '+ Add a place'}
        </button>
      </div>

      {syncEnabled() && changes.length > 0 && (
        <div className="offline-card">
          <div className="offline-card-head">
            <strong>Your changes</strong>
            <span className="offline-sub">{changes.length} not on the shared map yet</span>
          </div>
          <ul className="change-rows">
            {changes.map((c) => (
              <li key={c.targetId}>
                <div className="offline-row">
                  <label className="checkbox">
                    <input type="checkbox" checked={!excluded.has(c.targetId)} onChange={() => toggleRow(c.targetId)} />
                    <span className="change-name">{c.name}</span>
                  </label>
                  <button
                    className="btn btn-small btn-icon"
                    title="Show on the map"
                    aria-label={`Show ${c.name} on the map`}
                    onClick={() => select(c.targetId)}
                  >
                    <MapPinIcon />
                  </button>
                  <button
                    className="btn btn-small btn-icon btn-danger"
                    title={DISCARD_LABEL[c.type]}
                    aria-label={`${DISCARD_LABEL[c.type]}: ${c.name}`}
                    onClick={() => discard(c)}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <span className="offline-sub">
                  {c.summary}
                  {c.rejected && <span className="sub-status rejected"> · was rejected: {c.rejected.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
          {email ? (
            <>
              {!admin && (
                <input
                  className="contrib-note"
                  placeholder="Note for the reviewer (optional)"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
              <button
                className="btn btn-primary contrib-submit"
                disabled={!online || submitting || !selected.length}
                onClick={submit}
              >
                {submitting
                  ? admin
                    ? 'Publishing…'
                    : 'Submitting…'
                  : admin
                    ? `Publish ${selected.length} to the map`
                    : `Submit ${selected.length} for review`}
              </button>
            </>
          ) : (
            <div className="offline-row">
              <span className="offline-sub">Sign in to submit — contributions carry your email for review.</span>
              <button className="btn btn-small btn-primary" onClick={signIn} disabled={!online}>
                Sign in
              </button>
            </div>
          )}
        </div>
      )}

      {submissions.length > 0 && (
        <div className="offline-card">
          <div className="offline-card-head">
            <strong>Your submissions</strong>
          </div>
          <ul className="submission-rows">
            {submissions.slice(0, 20).map((s) => (
              <li key={s.id}>
                <button
                  className="submission-open"
                  disabled={!onMap.has(s.data.targetId)}
                  title={onMap.has(s.data.targetId) ? `Show ${s.data.name} on the map` : 'No longer on the map'}
                  onClick={() => select(s.data.targetId)}
                >
                  <KindIcon type={s.data.type} />
                  <span className="change-name">{s.data.name}</span>
                  <StatusChip s={s} />
                </button>
                {s.data.type === 'photo' &&
                  (confirmPhoto === s.id ? (
                    <span className="row-confirm">
                      <button
                        className="btn btn-small btn-danger"
                        disabled={deletingPhoto || !online}
                        onClick={() => removePhoto(s)}
                      >
                        {deletingPhoto ? 'Deleting…' : 'Delete'}
                      </button>
                      <button className="btn btn-small btn-muted" onClick={() => setConfirmPhoto(undefined)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn btn-small btn-icon btn-danger"
                      title="Delete this photo"
                      aria-label={`Delete your photo of ${s.data.name}`}
                      onClick={() => setConfirmPhoto(s.id)}
                    >
                      <TrashIcon />
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="offline-card">
        <div className="offline-card-head">
          <strong>Coming next</strong>
        </div>
        <p className="offline-sub contrib-pitch">
          Community signals: how many people shortlisted, visited or rejected each spot (always anonymous), plus
          public ratings and comments — kept separate from your private notes.
        </p>
      </div>
    </div>
  )
}
