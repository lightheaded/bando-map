/** Authenticated calls to the sync API beyond /sync itself. */
import type { Submission, SubmissionData } from '../types'
import { SYNC } from './config'
import { getIdToken } from './auth'
import { checkForUpdate } from '../sw/update'
import { reportApiRefusal } from '../obs/sentry'

/**
 * A refused call, carrying what the API said about it. Every refusal answers
 * with `{ error }`, and that sentence is written for the user: "20 photos a day
 * is the limit" tells them what to do, where "POST /photos 429" does not.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getIdToken()
  if (!token) throw new Error('signed out')
  const res = await fetch(`${SYNC.apiUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  })
  if (!res.ok) {
    let reason = ''
    try {
      reason = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      /* not our error shape — the status has to speak for itself */
    }
    // An app running older code than the API it calls fails exactly like this,
    // so a refusal is the moment to find out whether a new build is waiting.
    checkForUpdate()
    reportApiRefusal(init?.method ?? 'GET', path, res.status, reason)
    throw new ApiError(res.status, reason || `${init?.method ?? 'GET'} ${path} failed (${res.status})`)
  }
  return res.json()
}

export const fetchMySubmissions = () => request<{ submissions: Submission[] }>('/submissions')

export const postSubmission = (data: SubmissionData) =>
  request<{ submission: Submission }>('/submissions', { method: 'POST', body: JSON.stringify(data) })

/** A prepared photo plus what it is a photo of. `own` is the licence declaration. */
export interface PhotoUpload {
  targetId: number
  name: string
  own: true
  credit?: string
  note?: string
  full: string
  thumb: string
}

export const postPhoto = (body: PhotoUpload) =>
  request<{ submission: Submission }>('/photos', { method: 'POST', body: JSON.stringify(body) })

/**
 * Take a photo back: the contributor's own, or any of them for an admin. A
 * pending one leaves the review queue, a published one also leaves the map.
 * The stored renders go with it — there is no undo, and no copy left behind.
 */
export const deletePhoto = (id: string) => request<{ deleted: string }>(`/photos/${id}`, { method: 'DELETE' })

/**
 * Both renders of a photo submission, base64. Pending photos are not on the CDN,
 * so this is the only way to look at one — the API allows it for the contributor
 * and for reviewers.
 */
export const fetchPhoto = (id: string) =>
  request<{ full: string; thumb: string; contentType: string }>(`/photos/${id}`)

/**
 * One day of traffic, rolled up from CloudFront access logs (backend/rollup.mjs).
 * `views` and `visitors` count clients with a browser-like user agent, `botViews`
 * the self-identified crawlers; `other` is every non-page request (assets, data
 * files, probes). Countries are ISO 3166-1 alpha-2, `??` when CloudFront could
 * not place the viewer.
 */
export interface VisitDay {
  date: string
  views: number
  visitors: number
  botViews: number
  other: number
  countries: Record<string, number>
  botCountries: Record<string, number>
  updatedAt?: string
}

export interface AdminOverview {
  submissions: Submission[]
  users: { email?: string; createdAt?: string; lastSyncAt?: string }[]
  visits?: VisitDay[]
}

export const fetchAdminOverview = () => request<AdminOverview>('/admin/overview')

export const decideSubmission = (id: string, action: 'approve' | 'reject' | 'reopen', reason?: string) =>
  request<{ submission: Submission }>(`/admin/submissions/${id}`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  })
