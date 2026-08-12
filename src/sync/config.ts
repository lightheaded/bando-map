/**
 * Sync backend endpoints — public identifiers, filled from `terraform output`
 * after applying infra/backend.tf. Empty clientId disables the sync UI.
 */
export const SYNC = {
  apiUrl: 'https://api.bando.lagle.xyz',
  authDomain: 'https://bando-map.auth.eu-north-1.amazoncognito.com',
  clientId: '5mb278mpp2afjblnnd0behb3bd',
  /**
   * Cognito group whose members see the Admin tab. Cosmetic only — the API
   * re-checks the same group claim on every /admin route. Membership lives in
   * Cognito, so no personal identifier ships in this bundle.
   */
  adminGroup: 'admin',
}

export const syncEnabled = () => SYNC.clientId !== ''
