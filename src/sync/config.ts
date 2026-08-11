/**
 * Sync backend endpoints — public identifiers, filled from `terraform output`
 * after applying infra/backend.tf. Empty clientId disables the sync UI.
 */
export const SYNC = {
  apiUrl: 'https://api.bando.lagle.xyz',
  authDomain: 'https://bando-map.auth.eu-north-1.amazoncognito.com',
  clientId: '5mb278mpp2afjblnnd0behb3bd',
  /**
   * Who sees the Admin tab. Cosmetic only — the API enforces the real list
   * (ADMIN_EMAILS in infra/backend.tf) on every /admin route.
   */
  adminEmails: ['admin@example.invalid'],
}

export const syncEnabled = () => SYNC.clientId !== ''
export const isAdmin = (email?: string) => !!email && SYNC.adminEmails.includes(email)
