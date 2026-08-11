import { useAppStore } from '../state/store'
import { syncEnabled } from '../sync/config'
import { signIn } from '../sync/auth'
import { syncNow, signOut } from '../sync/sync'
import { useOnline } from './useOnline'
import { SyncIcon } from './icons'

export function SyncButton() {
  const open = useAppStore((s) => s.panel === 'sync')
  const togglePanel = useAppStore((s) => s.togglePanel)
  const email = useAppStore((s) => s.sync.email)
  if (!syncEnabled()) return null
  return (
    <button
      className={open ? 'active' : ''}
      onClick={() => togglePanel('sync')}
      aria-expanded={open}
      title={email ? `Signed in as ${email}` : 'Sync across devices'}
    >
      <SyncIcon />
      Sync
    </button>
  )
}

function timeAgo(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

/** Cross-device sync: sign-in offer, or status + manual sync when signed in. */
export function SyncPanel() {
  const open = useAppStore((s) => s.panel === 'sync')
  const sync = useAppStore((s) => s.sync)
  const online = useOnline()
  if (!open || !syncEnabled()) return null
  return (
    <div className="offline-panel">
      <div className="offline-card">
        {sync.email ? (
          <>
            <div className="offline-card-head">
              <strong>Synced across devices</strong>
              <span className="offline-sub">{sync.email}</span>
            </div>
            <div className="offline-row">
              <span className="offline-sub">
                {sync.state === 'syncing'
                  ? 'syncing…'
                  : sync.state === 'error'
                    ? online
                      ? 'sync failed — will retry'
                      : 'offline — will sync when back online'
                    : sync.lastAt
                      ? `last synced ${timeAgo(sync.lastAt)}`
                      : 'not synced yet'}
              </span>
              <span className="offline-actions">
                <button className="btn btn-small" onClick={() => syncNow()} disabled={!online || sync.state === 'syncing'}>
                  Sync now
                </button>
                <button className="btn btn-small btn-muted" onClick={signOut}>
                  Sign out
                </button>
              </span>
            </div>
          </>
        ) : (
          <div className="offline-row">
            <span className="offline-sub">
              <strong className="sync-pitch">Sync across devices</strong>
              Your shortlist, visits, notes and pin fixes on every device.
            </span>
            <button className="btn btn-small btn-primary" onClick={signIn} disabled={!online}>
              Sign in
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
