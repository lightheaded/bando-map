/**
 * Sync backend endpoints — public identifiers, filled from `terraform output`
 * after applying infra/backend.tf. Empty clientId disables the sync UI.
 */
export const SYNC = {
  apiUrl: 'https://api.bando.lagle.xyz',
  authDomain: 'https://bando-map.auth.eu-north-1.amazoncognito.com',
  clientId: '5mb278mpp2afjblnnd0behb3bd',
}

export const syncEnabled = () => SYNC.clientId !== ''
