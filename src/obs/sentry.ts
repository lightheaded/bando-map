/**
 * Error reporting.
 *
 * The app used to tell nobody when it broke. A crash inside a component left a
 * blank page, and a refused API call left a toast that only the person in front
 * of the screen ever saw. Both are now reported to Sentry, with the version
 * that produced them.
 *
 * Nothing about the person using the app goes with the report. `sendDefaultPii`
 * is off, the signed-in email address is never attached, and `beforeSend`
 * removes anything an integration adds on its own. What Sentry receives is a
 * stack trace, a build number and the page path.
 */
import * as Sentry from '@sentry/react'
import type { ErrorEvent, EventHint } from '@sentry/react'

/**
 * Write-only ingest key for the `bando-map` project, in the EU region. Public
 * by design — it can post an event and read nothing — and it ships in the
 * bundle like the Cognito client id does. Rotate it in the Sentry project's
 * Client Keys page if it ever needs to change.
 */
const DSN = 'https://45014709103b167c8ee45f69ecbdd6ac@o4511915104665600.ingest.de.sentry.io/4511982593310800'

/**
 * The login redirect lands on `/?code=…&state=…`. That code is single-use and
 * expires in minutes, but it is still a credential, and no query string this
 * app uses is worth reporting. Drop every one of them and keep the hash, which
 * is the public deep link to a place.
 */
function scrubUrl(raw: string): string {
  const q = raw.indexOf('?')
  if (q === -1) return raw
  const hash = raw.indexOf('#', q)
  return hash === -1 ? raw.slice(0, q) : raw.slice(0, q) + raw.slice(hash)
}

function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  delete event.user
  if (event.request) {
    delete event.request.headers
    delete event.request.cookies
    if (event.request.url) event.request.url = scrubUrl(event.request.url)
  }
  return event
}

/** Start reporting. Call before anything else, so early crashes are caught too. */
export function initErrorReporting(): void {
  Sentry.init({
    dsn: DSN,
    // A dev server produces the errors you are already looking at. Sending them
    // would spend the monthly quota on noise and bury the real reports.
    enabled: import.meta.env.PROD,
    release: `bando-map@${__APP_VERSION__}`,
    environment: import.meta.env.PROD ? 'production' : 'development',
    sendDefaultPii: false,
    // Errors only. Tracing bills per transaction and answers a question this
    // app does not have — one page, one map, no server render.
    tracesSampleRate: 0,
    beforeSend,
    ignoreErrors: [
      // This app is built to be used with no signal, so a failed request is a
      // normal event, not a fault. Refused API calls are reported explicitly
      // below, which keeps the real failures visible without this noise.
      'Failed to fetch',
      'NetworkError when attempting to fetch resource',
      'Load failed',
      'The network connection was lost',
      'The Internet connection appears to be offline',
      // Fired by browsers when a layout pass runs long. Harmless, and nothing
      // in this app can act on it.
      'ResizeObserver loop',
    ],
    // Errors thrown by an extension injected into the page are not this app's.
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-web-extension:\/\//],
  })
}

/**
 * Collapse the ids out of a path, so every call to the same route groups into
 * one issue: `/photos/9f2c…` and `/photos/1a7b…` are the same route refused
 * twice, not two unrelated problems.
 */
function routeOf(path: string): string {
  return path
    .split('/')
    .map((seg) => (seg.length >= 16 || /^\d+$/.test(seg) ? '{id}' : seg))
    .join('/')
}

/**
 * An API call the API refused.
 *
 * These never reach the global handler: every caller catches the error and puts
 * the reason in a toast. That is right for the person holding the phone and
 * useless for anyone fixing it, which is how a photo upload could fail with
 * nothing left behind that named the cause.
 *
 * A 401 is left out. A token expires after an hour by design, and the app signs
 * in again — that is the token working, not the app failing.
 */
export function reportApiRefusal(method: string, path: string, status: number, reason: string): void {
  if (status === 401) return
  const route = `${method} ${routeOf(path)}`
  Sentry.captureMessage(`${route} refused (${status})`, {
    level: status >= 500 ? 'error' : 'warning',
    tags: { api_route: route, api_status: String(status) },
    extra: { reason },
  })
}
