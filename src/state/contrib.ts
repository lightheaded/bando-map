import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CommunityOverride, Submission } from '../types'
import { fetchMySubmissions } from '../sync/api'
import { useAppStore } from './store'
import { useMarksStore } from './marks'

interface ContribState {
  /** Mirror of the server's list of this user's submissions. */
  submissions: Submission[]
  setSubmissions: (submissions: Submission[]) => void
}

/** Persisted so submission history shows offline / before the first refresh. */
export const useContribStore = create<ContribState>()(
  persist((set) => ({ submissions: [], setSubmissions: (submissions) => set({ submissions }) }), {
    name: 'bando-map:contrib',
  }),
)

/** Pull the caller's submissions from the server; quiet no-op when offline. */
export async function refreshSubmissions(): Promise<void> {
  try {
    const { submissions } = await fetchMySubmissions()
    useContribStore.getState().setSubmissions(submissions)
  } catch {
    /* offline or signed out — the persisted mirror stands */
  }
}

/** A local correction, new place, or proposed deletion not on the shared map yet. */
export interface LocalChange {
  targetId: number
  type: 'edit' | 'place' | 'delete'
  name: string
  /** Shared-map values at this moment, for the reviewer's diff. */
  before?: CommunityOverride
  after: CommunityOverride
  /** e.g. "moved pin · name, usage" */
  summary: string
  /** Per-change context for the reviewer — the reason on a deletion. */
  note?: string
  /** The rejection a resubmission would supersede, if any. */
  rejected?: Submission
}

/** Key-order-independent equality for override payloads. */
const fingerprint = (o: CommunityOverride) =>
  JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))

/**
 * The user's shareable changes (Move fixes, field edits, custom places) not
 * yet covered by a pending or approved submission. Personal state — shortlist,
 * visits, ratings, notes — never leaves the device this way.
 */
export function useLocalChanges(): LocalChange[] {
  const marks = useMarksStore((s) => s.marks)
  const places = useMarksStore((s) => s.places)
  const bandos = useAppStore((s) => s.bandos)
  const submissions = useContribStore((s) => s.submissions)

  return useMemo(() => {
    const changes: LocalChange[] = []
    for (const [idStr, m] of Object.entries(marks)) {
      const id = Number(idStr)
      if (m.remove) {
        // A community place the user contributed themselves is skipped by
        // mergeCommunity in favour of their local copy — look there too.
        const target = bandos.find((x) => x.id === id) ?? places.find((p) => p.id === id)
        if (!target) continue
        changes.push({
          targetId: id,
          type: 'delete',
          name: target.name,
          before: { name: target.name, lat: Number(target.lat.toFixed(6)), lon: Number(target.lon.toFixed(6)) },
          after: {},
          summary: `delete — ${m.remove.reason}`,
          note: m.remove.reason,
        })
        continue // on its way out, so its corrections are moot
      }
      if (id <= 0 || (!m.fix && !m.edits)) continue
      const b = bandos.find((x) => x.id === id)
      if (!b) continue
      const after: CommunityOverride = {
        ...(m.fix ? { lat: Number(m.fix.lat.toFixed(6)), lon: Number(m.fix.lon.toFixed(6)) } : {}),
        ...m.edits,
      }
      const before: CommunityOverride = {}
      if (m.fix) {
        before.lat = Number(b.lat.toFixed(6))
        before.lon = Number(b.lon.toFixed(6))
      }
      for (const key of Object.keys(m.edits ?? {}) as (keyof CommunityOverride)[]) {
        if (key !== 'lat' && key !== 'lon') before[key] = b[key] as string | undefined
      }
      const parts = []
      if (m.fix) parts.push('moved pin')
      if (m.edits) parts.push(Object.keys(m.edits).join(', '))
      changes.push({ targetId: id, type: 'edit', name: m.edits?.name ?? b.name, before, after, summary: parts.join(' · ') })
    }
    for (const p of places) {
      if (marks[p.id]?.remove) continue // proposed for deletion, not for adding
      changes.push({
        targetId: p.id,
        type: 'place',
        name: p.name,
        after: { name: p.name, lat: Number(p.lat.toFixed(6)), lon: Number(p.lon.toFixed(6)) },
        summary: 'new place',
      })
    }
    // A change already submitted (and not rejected) in this exact form is off
    // the to-submit list; a rejected one comes back, tagged with the verdict.
    return changes.flatMap((c) => {
      // Nothing to contribute when the shared map already matches (e.g. an
      // identical fix by someone else was approved meanwhile).
      if (c.type === 'edit' && Object.entries(c.after).every(([k, v]) => c.before?.[k as keyof CommunityOverride] === v))
        return []
      const same = submissions.filter((s) => s.data.targetId === c.targetId && fingerprint(s.data.after) === fingerprint(c.after))
      if (same.some((s) => s.status !== 'rejected')) return []
      return [{ ...c, rejected: same.find((s) => s.status === 'rejected') }]
    })
  }, [marks, places, bandos, submissions])
}
