/**
 * Cognito hosted-UI sign-in with PKCE — no auth library, ~100 lines.
 * Tokens live in localStorage; the ID token authenticates /sync calls and
 * refreshes silently via the refresh token (90 days).
 */
import { SYNC } from './config'

interface Tokens {
  idToken: string
  refreshToken?: string
  /** ms epoch when idToken expires. */
  exp: number
  email?: string
}

const TOKENS_KEY = 'bando-map:auth'
const PKCE_KEY = 'bando-map:pkce'
const RETURN_KEY = 'bando-map:auth-return'

function load(): Tokens | undefined {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '') as Tokens
  } catch {
    return undefined
  }
}

function save(t?: Tokens) {
  if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t))
  else localStorage.removeItem(TOKENS_KEY)
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const redirectUri = () => `${location.origin}/`

function fromTokenResponse(r: { id_token: string; refresh_token?: string }): Tokens {
  const claims = JSON.parse(atob(r.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  return {
    idToken: r.id_token,
    refreshToken: r.refresh_token ?? load()?.refreshToken,
    exp: claims.exp * 1000,
    email: claims.email,
  }
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens | undefined> {
  const res = await fetch(`${SYNC.authDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SYNC.clientId, ...body }),
  })
  if (!res.ok) return undefined
  return fromTokenResponse(await res.json())
}

/** Redirect to the hosted login page; the current deep link is restored after. */
export async function signIn() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  sessionStorage.setItem(PKCE_KEY, verifier)
  sessionStorage.setItem(RETURN_KEY, location.hash)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const params = new URLSearchParams({
    client_id: SYNC.clientId,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: b64url(new Uint8Array(digest)),
  })
  location.href = `${SYNC.authDomain}/oauth2/authorize?${params}`
}

/** Call on app start: exchanges the ?code= from a login redirect, if present. */
export async function completeSignIn(): Promise<boolean> {
  const code = new URLSearchParams(location.search).get('code')
  const verifier = sessionStorage.getItem(PKCE_KEY)
  if (!code || !verifier) return false
  sessionStorage.removeItem(PKCE_KEY)
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier })
  if (!tokens) return false
  save(tokens)
  const returnHash = sessionStorage.getItem(RETURN_KEY) ?? ''
  sessionStorage.removeItem(RETURN_KEY)
  history.replaceState(null, '', location.pathname + returnHash)
  return true
}

/** Valid ID token, silently refreshed when near expiry; undefined = signed out. */
export async function getIdToken(): Promise<string | undefined> {
  const t = load()
  if (!t) return undefined
  if (Date.now() < t.exp - 60_000) return t.idToken
  if (!t.refreshToken) {
    save(undefined)
    return undefined
  }
  const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
  save(refreshed)
  return refreshed?.idToken
}

export const sessionEmail = (): string | undefined => load()?.email

export function signOut() {
  save(undefined)
}
