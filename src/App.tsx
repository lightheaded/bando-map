import { useEffect } from 'react'
import { MapView } from './map/MapView'
import { Sidebar } from './components/Sidebar'
import { AddPlaceForm } from './components/AddPlace'
import { useDeepLink } from './state/deeplink'
import { useAppStore } from './state/store'
import type { BandoDataset } from './types'

export default function App() {
  const setDataset = useAppStore((s) => s.setDataset)
  useDeepLink()

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/bandos.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`bandos.json HTTP ${r.status}`)
        return r.json()
      })
      .then((d: BandoDataset) => setDataset(d))
      .catch((err) => console.error('Failed to load dataset:', err))
  }, [setDataset])

  return (
    <div className="app">
      <MapView />
      <Sidebar />
      <AddPlaceForm />
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
