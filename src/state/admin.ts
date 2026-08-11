import { create } from 'zustand'
import { fetchAdminOverview, type AdminOverview } from '../sync/api'

interface AdminState {
  overview?: AdminOverview
  setOverview: (overview?: AdminOverview) => void
}

/** Not persisted — the review queue is fetched fresh, it decides real actions. */
export const useAdminStore = create<AdminState>((set) => ({
  setOverview: (overview) => set({ overview }),
}))

/** Quiet no-op when offline or not an admin (the API answers 403). */
export async function refreshAdminOverview(): Promise<void> {
  try {
    useAdminStore.getState().setOverview(await fetchAdminOverview())
  } catch {
    /* keep whatever we had */
  }
}
