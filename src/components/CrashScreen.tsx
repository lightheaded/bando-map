import type { FallbackRender } from '@sentry/react'

/**
 * What the app shows when a render throws.
 *
 * React unmounts the whole tree when nothing catches an error, and the result
 * is a white page with no explanation — indistinguishable from a failed load,
 * and impossible to report. This says what happened, offers the one action that
 * helps, and shows the id of the report so it can be quoted. It does not claim
 * the report arrived: reporting is off in development, and a phone with no
 * signal has nowhere to send it.
 */
export const CrashScreen: FallbackRender = ({ error, eventId }) => (
  <div className="crash">
    <h1>Something broke</h1>
    <p>The app hit an error it could not recover from.</p>
    <p className="crash-detail">{error instanceof Error ? error.message : String(error)}</p>
    <button className="btn btn-primary" onClick={() => window.location.reload()}>
      Reload the app
    </button>
    {eventId && <p className="crash-id">Report {eventId}</p>}
  </div>
)
