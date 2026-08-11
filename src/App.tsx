import { useEffect } from 'react'
import { MapView } from './map/MapView'
import { LayerSwitcher } from './components/LayerSwitcher'
import { DetailPanel } from './components/DetailPanel'
import { useAppStore } from './state/store'
import type { BandoDataset } from './types'

export default function App() {
  const setDataset = useAppStore((s) => s.setDataset)

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
      <LayerSwitcher />
      <DetailPanel />
      <Toast />
    </div>
  )
}

function Toast() {
  const toast = useAppStore((s) => s.toast)
  if (!toast) return null
  return (
    <div className="toast" role="status">
      {toast}
    </div>
  )
}
