/**
 * Keeping the running app and the deployed one in step.
 *
 * A service worker only learns that a new build exists when something asks it
 * to look. A page load asks. A timer asks. Neither happens in an installed PWA
 * that sat in the background since yesterday: its timers are throttled or
 * frozen, and standalone windows do no navigation. So the app can go on running
 * last week's code against today's API, and the first sign of it is a request
 * that fails for no reason the user can see.
 *
 * The cure is to ask again at every moment the app comes back into use, and
 * once more whenever a call to the API is refused.
 */

let registration: ServiceWorkerRegistration | undefined
let lastCheck = 0

/** Repeat checks inside this window are dropped — a resume fires several events at once. */
const MIN_GAP_MS = 60_000
const POLL_MS = 60 * 60 * 1000

/** Remember the registration that registerSW produced. */
export function trackRegistration(r: ServiceWorkerRegistration | undefined): void {
  registration = r
}

/**
 * Ask the service worker to look for a new build. Silent either way: a new one
 * raises the update banner through registerSW's own callback, and a failed
 * check means offline, which is not the user's problem.
 */
export function checkForUpdate(): void {
  if (!registration) return
  const now = Date.now()
  if (now - lastCheck < MIN_GAP_MS) return
  lastCheck = now
  registration.update().catch(() => {})
}

/** Every moment worth re-checking at. Call once, after registration. */
export function watchForUpdates(): void {
  setInterval(checkForUpdate, POLL_MS)
  // Back in the foreground after the app was frozen — the moment that matters
  // most, because the user is about to do something.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
  window.addEventListener('focus', checkForUpdate)
  // A deploy that landed while the device had no network.
  window.addEventListener('online', checkForUpdate)
}
