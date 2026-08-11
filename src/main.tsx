import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

registerSW({ immediate: true })

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
