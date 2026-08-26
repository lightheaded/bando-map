import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { useAppStore } from './state/store'
import { trackRegistration, watchForUpdates } from './sw/update'
import App from './App'
import './styles.css'

const offerUpdate = () => useAppStore.setState({ updateApp: () => window.location.reload() })

registerSW({
  immediate: true,
  // A new version already activated in the background (the next refresh gets
  // it either way) — instead of the default forced reload, the UpdateBanner
  // shows (re-showing hourly after a dismissal) so the user reloads when it
  // suits them.
  onNeedReload: offerUpdate,
  onRegisteredSW(_url, registration) {
    trackRegistration(registration)
    watchForUpdates()
  },
})

// Second route to the same banner. The callback above reaches this page only
// through the worker instance registerSW made; a worker installed by another
// tab, or by the browser's own check, can take this page over without it. A
// controller arriving where one already stood means the code running here is
// the old build, whatever the reason — and that is the whole thing to know.
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', offerUpdate)
}

// First-visit warm-up: the app fetches the dataset before the service worker
// takes control, so that request bypasses the cache. Re-fetch through the SW
// as soon as it's in charge — otherwise the very first visit wouldn't survive
// going offline.
const warmUp = () => {
  fetch(`${import.meta.env.BASE_URL}data/bandos.json`).catch(() => {})
}
if ('serviceWorker' in navigator) {
  if (navigator.serviceWorker.controller) warmUp()
  else navigator.serviceWorker.addEventListener('controllerchange', warmUp, { once: true })
}

// Scrolling with the pointer over a focused number input edits its value
// instead of scrolling the page — easy to do by accident on a trackpad, and
// silent when it happens. Blurring on wheel gives the scroll back to the page
// and leaves the value alone. Passive: we never cancel the scroll itself.
document.addEventListener(
  'wheel',
  (e) => {
    const el = e.target
    if (el instanceof HTMLInputElement && el.type === 'number' && el === document.activeElement) el.blur()
  },
  { passive: true },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
