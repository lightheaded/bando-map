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

export interface AdminOverview {
  submissions: Submission[]
  users: { email?: string; createdAt?: string; lastSyncAt?: string }[]
}

export const fetchAdminOverview = () => request<AdminOverview>('/admin/overview')

export const decideSubmission = (id: string, action: 'approve' | 'reject' | 'reopen', reason?: string) =>
  request<{ submission: Submission }>(`/admin/submissions/${id}`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  })
