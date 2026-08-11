import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
import { useContribStore, useLocalChanges, refreshSubmissions } from '../state/contrib'
import { postSubmission } from '../sync/api'
import { syncEnabled } from '../sync/config'
import { signIn } from '../sync/auth'
import { useOnline } from './useOnline'
import { EditIcon, MapPinIcon } from './icons'
import type { Submission } from '../types'

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

function StatusChip({ s }: { s: Submission }) {
  if (s.status === 'pending') return <span className="sub-status pending">pending · {age(s.createdAt)}</span>
  if (s.status === 'approved') return <span className="sub-status approved">✓ live</span>
  return <span className="sub-status rejected">✕ {s.reason}</span>
}

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
  const setPlaceDraft = useAppStore((s) => s.setPlaceDraft)
  const setSheetOpen = useAppStore((s) => s.setSheetOpen)
  const showToast = useAppStore((s) => s.showToast)
  const email = useAppStore((s) => s.sync.email)
  const changes = useLocalChanges()
  const submissions = useContribStore((s) => s.submissions)
  const online = useOnline()
  const select = useAppStore((s) => s.select)
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open && email) refreshSubmissions()
  }, [open, email])

  if (!open) return null

  const picking = placeDraft === 'picking'
  const selected = changes.filter((c) => !excluded.has(c.targetId))

  const startAdd = () => {
    if (picking) {
      setPlaceDraft(undefined)
      return
    }
    setPlaceDraft('picking')
    setSheetOpen(false) // reveal the map under the mobile sheet
    showToast('Tap the map where the spot is')
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
    try {
      // One atomic submission per place, so a rejection never drags down
      // unrelated good edits.
      for (const c of selected) {
        await postSubmission({
          type: c.type,
          targetId: c.targetId,
          name: c.name,
          before: c.before,
          after: c.after,
          note: note.trim() || undefined,
        })
        sent++
      }
      setNote('')
      showToast(`Submitted ${sent} change${sent === 1 ? '' : 's'} for review`)
    } catch {
      showToast(sent ? `Submitted ${sent}, then failed — try again for the rest` : 'Submitting failed — try again')
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
          Bando Map is community-sourced: move mispinned spots, fix wrong details, add missing places. Submit your
          changes for review — approved ones go live on everyone's map.
        </p>
        <button className={`btn btn-small ${picking ? 'btn-rejected' : ''}`} onClick={startAdd}>
          {picking ? 'Cancel adding' : '+ Add a place'}
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
              <input
                className="contrib-note"
                placeholder="Note for the reviewer (optional)"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="btn btn-primary contrib-submit"
                disabled={!online || submitting || !selected.length}
                onClick={submit}
              >
                {submitting ? 'Submitting…' : `Submit ${selected.length} for review`}
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
                <span className="change-name">{s.data.name}</span>
                <StatusChip s={s} />
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
