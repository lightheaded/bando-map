import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserData, UserMark } from '../types'

interface MarksState {
  marks: Record<number, UserMark>
  setMark: (id: number, patch: Partial<Omit<UserMark, 'updatedAt'>>) => void
  importData: (data: UserData) => { merged: number }
}

export const useMarksStore = create<MarksState>()(
  persist(
    (set, get) => ({
      marks: {},
      setMark: (id, patch) =>
        set((s) => ({
          marks: { ...s.marks, [id]: { ...s.marks[id], ...patch, updatedAt: new Date().toISOString() } },
        })),
      importData: (data) => {
        if (data.version !== 1 || typeof data.marks !== 'object') throw new Error('Unrecognized export format')
        const current = { ...get().marks }
        let merged = 0
        for (const [key, incoming] of Object.entries(data.marks)) {
          const id = Number(key)
          const existing = current[id]
          // Newer edit wins, per mark.
          if (!existing || (incoming.updatedAt ?? '') > (existing.updatedAt ?? '')) {
            current[id] = incoming
            merged++
          }
        }
        set({ marks: current })
        return { merged }
      },
    }),
    { name: 'bando-map:user', version: 1 },
  ),
)

export function exportUserData(): UserData {
  return { version: 1, marks: useMarksStore.getState().marks }
}

export function downloadUserData() {
  const blob = new Blob([JSON.stringify(exportUserData(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bando-map-export-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
