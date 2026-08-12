/**
 * Cross-device sync: pull the remote document, merge it locally (per-mark
 * updatedAt, the same logic as JSON import), push the merged result back.
 * The server never merges — it just stores the latest document per user.
 */
import { useAppStore } from '../state/store'
import { useMarksStore, exportUserData } from '../state/marks'
import { refreshSubmissions } from '../state/contrib'
import { refreshAdminOverview } from '../state/admin'
import { SYNC, syncEnabled } from './config'
import { completeSignIn, getIdToken, sessionEmail, sessionIsAdmin, signOut as authSignOut } from './auth'

let syncing = false
let pushTimer: ReturnType<typeof setTimeout> | undefined

const setSync = (patch: Partial<ReturnType<typeof useAppStore.getState>['sync']>) =>
  useAppStore.setState((s) => ({ sync: { ...s.sync, ...patch } }))

export async function syncNow(): Promise<void> {
  if (syncing || !syncEnabled()) return
  const token = await getIdToken()
  if (!token) {
    setSync({ email: undefined, admin: false, state: 'idle' })
    return
  }
  syncing = true
  setSync({ state: 'syncing' })
  try {
    const auth = { authorization: `Bearer ${token}` }
    const res = await fetch(`${SYNC.apiUrl}/sync`, { headers: auth })
    if (res.ok) {
      const { data } = await res.json()
      useMarksStore.getState().importData(data)
    } else if (res.status !== 404) {
      throw new Error(`GET /sync ${res.status}`)
    }
    const put = await fetch(`${SYNC.apiUrl}/sync`, {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(exportUserData()),
    })
    if (!put.ok) throw new Error(`PUT /sync ${put.status}`)
    setSync({ email: sessionEmail(), admin: sessionIsAdmin(), state: 'idle', lastAt: Date.now() })
  } catch {
    setSync({ email: sessionEmail(), admin: sessionIsAdmin(), state: 'error' })
  } finally {
    syncing = false
  }
}

export function signOut() {
  clearTimeout(pushTimer)
  authSignOut()
  setSync({ email: undefined, admin: false, state: 'idle', lastAt: undefined })
}

/** App-start hook: finish a login redirect, sync, and auto-push edits. */
export function initSync() {
  if (!syncEnabled()) return
  completeSignIn().then(() => {
    const email = sessionEmail()
    if (email) {
      setSync({ email, admin: sessionIsAdmin() })
      syncNow()
      refreshSubmissions()
      if (sessionIsAdmin()) refreshAdminOverview() // populates the Admin tab badge
    }
  })
  // Any local edit schedules a push (debounced; the merge makes it idempotent).
  useMarksStore.subscribe(() => {
    if (syncing || !sessionEmail()) return
    clearTimeout(pushTimer)
    pushTimer = setTimeout(syncNow, 4000)
  })
}
