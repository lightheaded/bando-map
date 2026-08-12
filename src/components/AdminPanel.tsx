import { useEffect, useState, type ReactNode } from 'react'
import { useAppStore } from '../state/store'
import { useAdminStore, refreshAdminOverview } from '../state/admin'
import { decideSubmission } from '../sync/api'
import { en, type Submission } from '../types'
import { age } from './ContributePanel'
import { ShieldIcon } from './icons'

const REJECT_REASONS = ['duplicate', 'wrong location', "can't verify", 'not a usable spot', 'other'] as const

export function AdminButton() {
  const open = useAppStore((s) => s.panel === 'admin')
  const togglePanel = useAppStore((s) => s.togglePanel)
  const admin = useAppStore((s) => s.sync.admin)
  const pending = useAdminStore((s) => s.overview?.submissions.filter((x) => x.status === 'pending').length ?? 0)
  if (!admin) return null
  return (
    <button className={open ? 'active' : ''} onClick={() => togglePanel('admin')} aria-expanded={open} title="Review community submissions">
      <ShieldIcon />
      Admin
      {pending > 0 && <span className="tab-badge">{pending}</span>}
    </button>
  )
}

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 6_371_000 * 2 * Math.asin(Math.sqrt(s))
}

/** Old → new per changed field; a pin move shows the distance instead. */
function DiffRows({ s }: { s: Submission }) {
  const { before, after, note, type } = s.data
  const rows: ReactNode[] = []
  if (after.lat != null && after.lon != null) {
    const moved = before?.lat != null && before?.lon != null
    rows.push(
      <li key="pin">
        <span className="diff-field">pin</span>
        {moved
          ? `moved ~${Math.round(distanceMeters({ lat: before.lat!, lon: before.lon! }, { lat: after.lat, lon: after.lon }))} m`
          : `${after.lat.toFixed(5)}, ${after.lon.toFixed(5)}`}
      </li>,
    )
  }
  for (const key of ['name', 'address', 'period', 'usage', 'condition'] as const) {
    if (after[key] == null || (type === 'place' && key === 'name')) continue
    rows.push(
      <li key={key}>
        <span className="diff-field">{key}</span>
        <s>{en(before?.[key]) ?? '—'}</s> → <b>{en(after[key])}</b>
      </li>,
    )
  }
  if (note) {
    rows.push(
      <li key="note">
        <span className="diff-field">note</span>
        {note}
      </li>,
    )
  }
  return <ul className="diff-rows">{rows}</ul>
}

const ageClass = (iso: string) => {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000
  return days < 3 ? 'age-fresh' : days < 7 ? 'age-warm' : 'age-old'
}

/**
 * The review queue, on the map: stats up top, then one card per pending
 * submission with an old→new diff and a map overlay for pin moves. Approving
 * publishes to everyone within seconds; rejecting requires a reason the
 * contributor will see.
 */
export function AdminPanel() {
  const open = useAppStore((s) => s.panel === 'admin')
  const setReviewDiff = useAppStore((s) => s.setReviewDiff)
  const showToast = useAppStore((s) => s.showToast)
  const overview = useAdminStore((s) => s.overview)
  const [busy, setBusy] = useState<string>()
  const [rejecting, setRejecting] = useState<string>()
  const [reason, setReason] = useState<string>(REJECT_REASONS[0])
  const [note, setNote] = useState('')
  const [diffFor, setDiffFor] = useState<string>()

  useEffect(() => {
    if (open) refreshAdminOverview()
    else {
      setReviewDiff(undefined)
      setDiffFor(undefined)
    }
  }, [open, setReviewDiff])

  if (!open) return null

  const subs = overview?.submissions ?? []
  const pending = [...subs.filter((s) => s.status === 'pending')].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  const decided = subs.filter((s) => s.status !== 'pending')
  const approvedCount = decided.filter((s) => s.status === 'approved').length
  const rejectedCount = decided.length - approvedCount
  const users = overview?.users ?? []
  const active30 = users.filter((u) => u.lastSyncAt && Date.now() - new Date(u.lastSyncAt).getTime() < 30 * 86_400_000).length
  const acceptedBy = new Map<string, number>()
  for (const s of subs) if (s.status === 'approved' && s.email) acceptedBy.set(s.email, (acceptedBy.get(s.email) ?? 0) + 1)

  const decide = async (s: Submission, action: 'approve' | 'reject' | 'reopen', why?: string) => {
    setBusy(s.id)
    try {
      await decideSubmission(s.id, action, why)
      setRejecting(undefined)
      setNote('')
      setDiffFor(undefined)
      setReviewDiff(undefined)
      showToast(
        action === 'approve'
          ? 'Approved — live on everyone’s map in a moment'
          : action === 'reject'
            ? 'Rejected — the contributor sees the reason'
            : 'Reopened',
      )
      await refreshAdminOverview()
    } catch {
      showToast('Action failed — try again')
    } finally {
      setBusy(undefined)
    }
  }

  const toggleDiff = (s: Submission) => {
    if (diffFor === s.id) {
      setDiffFor(undefined)
      setReviewDiff(undefined)
      return
    }
    const target = useAppStore.getState().bandos.find((b) => b.id === s.data.targetId)
    const after =
      s.data.after.lat != null && s.data.after.lon != null
        ? ([s.data.after.lon, s.data.after.lat] as [number, number])
        : target
          ? ([target.lon, target.lat] as [number, number])
          : undefined
    if (!after) return
    const before =
      s.data.before?.lat != null && s.data.before?.lon != null
        ? ([s.data.before.lon, s.data.before.lat] as [number, number])
        : undefined
    setDiffFor(s.id)
    setReviewDiff({ before, after })
  }

  return (
    <div className="offline-panel">
      <div className="offline-card">
        <div className="admin-stats">
          <div>
            <b>{users.length}</b>
            <span>users</span>
          </div>
          <div>
            <b>{active30}</b>
            <span>active 30 d</span>
          </div>
          <div>
            <b>{pending.length}</b>
            <span>pending</span>
          </div>
          <div>
            <b>{approvedCount}</b>
            <span>approved</span>
          </div>
          <div>
            <b>{rejectedCount}</b>
            <span>rejected</span>
          </div>
        </div>
        {acceptedBy.size > 0 && (
          <p className="offline-sub">
            Top contributors:{' '}
            {[...acceptedBy.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([e, n]) => `${e} (${n})`)
              .join(', ')}
          </p>
        )}
        {!overview && <p className="offline-sub">loading…</p>}
      </div>

      {pending.map((s) => (
        <div className="offline-card queue-card" key={s.id}>
          <div className="offline-card-head">
            <strong>{s.data.name}</strong>
            <span className={`age-chip ${ageClass(s.createdAt)}`}>{age(s.createdAt)}</span>
          </div>
          <p className="offline-sub">
            {s.data.type === 'place' ? 'new place' : 'correction'} · {s.email} · {acceptedBy.get(s.email ?? '') ?? 0}{' '}
            accepted
          </p>
          <DiffRows s={s} />
          <div className="offline-actions queue-actions">
            <button className="btn btn-small" onClick={() => toggleDiff(s)}>
              {diffFor === s.id ? 'Hide from map' : 'Show on map'}
            </button>
            <button className="btn btn-small btn-approve" disabled={busy === s.id} onClick={() => decide(s, 'approve')}>
              ✓ Approve
            </button>
            <button
              className="btn btn-small btn-danger"
              disabled={busy === s.id}
              onClick={() => setRejecting(rejecting === s.id ? undefined : s.id)}
            >
              ✕ Reject
            </button>
          </div>
          {rejecting === s.id && (
            <div className="reject-form">
              <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Rejection reason">
                {REJECT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                placeholder="Details — the contributor sees this"
                value={note}
                maxLength={400}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="btn btn-small btn-danger"
                disabled={busy === s.id}
                onClick={() => decide(s, 'reject', note.trim() ? `${reason} — ${note.trim()}` : reason)}
              >
                Confirm reject
              </button>
            </div>
          )}
        </div>
      ))}
      {overview && pending.length === 0 && (
        <div className="offline-card">
          <p className="offline-sub">Queue is empty — nothing waiting for review.</p>
        </div>
      )}

      {decided.length > 0 && (
        <details className="offline-card">
          <summary>
            <strong>Decided</strong>{' '}
            <span className="offline-sub">
              {approvedCount} approved · {rejectedCount} rejected
            </span>
          </summary>
          <ul className="submission-rows">
            {decided.slice(0, 15).map((s) => (
              <li key={s.id}>
                <span className="change-name">{s.data.name}</span>
                <span className={`sub-status ${s.status}`}>{s.status === 'approved' ? '✓ live' : `✕ ${s.reason}`}</span>
                <button className="btn btn-small btn-muted" disabled={busy === s.id} onClick={() => decide(s, 'reopen')}>
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {users.length > 0 && (
        <details className="offline-card">
          <summary>
            <strong>Users</strong>{' '}
            <span className="offline-sub">
              {users.length} registered · {active30} active in 30 d
            </span>
          </summary>
          <ul className="submission-rows">
            {users.map((u) => (
              <li key={u.email}>
                <span className="change-name">{u.email}</span>
                <span className="offline-sub">
                  {u.createdAt?.slice(0, 10)}
                  {u.lastSyncAt ? ` · synced ${age(u.lastSyncAt)} ago` : ' · never synced'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
