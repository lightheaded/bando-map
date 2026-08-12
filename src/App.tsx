import { useEffect, useRef } from 'react'
import { MapView } from './map/MapView'
import { Sidebar } from './components/Sidebar'
import { AddPlaceForm } from './components/AddPlace'
import { UpdateBanner } from './components/UpdateBanner'
import { useDeepLink } from './state/deeplink'
import { useAppStore } from './state/store'
import { initSync } from './sync/sync'
import type { BandoDataset, CommunityData } from './types'

export default function App() {
  const setDataset = useAppStore((s) => s.setDataset)
  useDeepLink()

  // Finish a login redirect and start auto-sync (no-op until configured).
  const syncStarted = useRef(false)
  useEffect(() => {
    if (syncStarted.current) return
    syncStarted.current = true
    initSync()
  }, [])

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/bandos.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`bandos.json HTTP ${r.status}`)
        return r.json()
      })
      .then((d: BandoDataset) => setDataset(d))
      .catch((err) => console.error('Failed to load dataset:', err))
    // Approved community contributions — absent until the first approval.
    fetch(`${import.meta.env.BASE_URL}data/community.json`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((c: CommunityData | undefined) => c && useAppStore.getState().setCommunity(c))
      .catch(() => {})
  }, [setDataset])

  return (
    <div className="app">
      <MapView />
      <Sidebar />
      <AddPlaceForm />
      <UpdateBanner />
      <Toast />
    </div>
  )
}

function Toast() {
  const toast = useAppStore((s) => s.toast)
  if (!toast) return null
  return (
    <div className="toast" role="status">
      {toast.msg}
      {toast.action && (
        <button
          className="toast-action"
          onClick={() => {
            toast.action!.onClick()
            useAppStore.setState({ toast: undefined })
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
