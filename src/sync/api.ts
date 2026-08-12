/** Authenticated calls to the sync API beyond /sync itself. */
import type { Submission, SubmissionData } from '../types'
import { SYNC } from './config'
import { getIdToken } from './auth'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getIdToken()
  if (!token) throw new Error('signed out')
  const res = await fetch(`${SYNC.apiUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} ${res.status}`)
  return res.json()
}

export const fetchMySubmissions = () => request<{ submissions: Submission[] }>('/submissions')

export const postSubmission = (data: SubmissionData) =>
  request<{ submission: Submission }>('/submissions', { method: 'POST', body: JSON.stringify(data) })

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
