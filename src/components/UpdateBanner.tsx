import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'

const SNOOZE_KEY = 'bando-map:update-snooze'
const SNOOZE_MS = 60 * 60 * 1000

/**
 * Top-of-screen notice while a new version is installed and waiting.
 * Closing it snoozes for an hour — installed PWAs stay open for days, so it
 * keeps coming back until the update is taken.
 */
export function UpdateBanner() {
  const updateApp = useAppStore((s) => s.updateApp)
  const [snoozedAt, setSnoozedAt] = useState<number>(() => Number(localStorage.getItem(SNOOZE_KEY) ?? 0))

  // Bring the banner back on its own when the snooze lapses mid-session.
  useEffect(() => {
    if (!snoozedAt) return
    const left = snoozedAt + SNOOZE_MS - Date.now()
    if (left <= 0) return
    const timer = setTimeout(() => setSnoozedAt(0), left + 1000)
    return () => clearTimeout(timer)
  }, [snoozedAt])

  if (!updateApp || Date.now() - snoozedAt < SNOOZE_MS) return null

  const snooze = () => {
    const now = Date.now()
    localStorage.setItem(SNOOZE_KEY, String(now))
    setSnoozedAt(now)
  }

  return (
    <div className="update-banner" role="status">
      <span>
        <strong>New version ready.</strong> Updating reloads the app — your spots, notes and map view are kept.
      </span>
      <button className="btn btn-small btn-primary" onClick={updateApp}>
        Update
      </button>
      <button className="update-banner-close" aria-label="Not now" title="Not now — reminds again in an hour" onClick={snooze}>
        ✕
      </button>
    </div>
  )
}
