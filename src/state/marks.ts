import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserData, UserMark, CustomPlace } from '../types'

interface MarksState {
  marks: Record<number, UserMark>
  places: CustomPlace[]
  setMark: (id: number, patch: Partial<Omit<UserMark, 'updatedAt'>>) => void
  addPlace: (place: Omit<CustomPlace, 'id' | 'createdAt'>) => number
  updatePlace: (id: number, patch: Partial<Omit<CustomPlace, 'id' | 'createdAt'>>) => void
  removePlace: (id: number) => void
  importData: (data: UserData) => { merged: number }
}

/** v1 marks used `hidden: boolean`; the triage workflow replaced it with `status`. */
function migrateV1Marks(marks: Record<number, UserMark & { hidden?: boolean }>): Record<number, UserMark> {
  const out: Record<number, UserMark> = {}
  for (const [id, m] of Object.entries(marks)) {
    const { hidden, ...rest } = m
    out[Number(id)] = hidden ? { ...rest, status: 'rejected' } : rest
  }
  return out
}

export const useMarksStore = create<MarksState>()(
  persist(
    (set, get) => ({
      marks: {},
      places: [],
      setMark: (id, patch) =>
        set((s) => ({
          marks: { ...s.marks, [id]: { ...s.marks[id], ...patch, updatedAt: new Date().toISOString() } },
        })),
      addPlace: (place) => {
        const id = -Date.now()
        set((s) => ({ places: [...s.places, { ...place, id, createdAt: new Date().toISOString() }] }))
        return id
      },
      updatePlace: (id, patch) =>
        set((s) => ({ places: s.places.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removePlace: (id) =>
        set((s) => {
          const marks = { ...s.marks }
          delete marks[id]
          return { places: s.places.filter((p) => p.id !== id), marks }
        }),
      importData: (data) => {
        if (data.version !== 1 || typeof data.marks !== 'object') throw new Error('Unrecognized export format')
        const current = { ...get().marks }
        let merged = 0
        for (const [key, raw] of Object.entries(data.marks)) {
          const id = Number(key)
          const incoming = migrateV1Marks({ [id]: raw })[id]
          const existing = current[id]
          // Newer edit wins, per mark.
          if (!existing || (incoming.updatedAt ?? '') > (existing.updatedAt ?? '')) {
            current[id] = incoming
            merged++
          }
        }
        const places = [...get().places]
        for (const place of data.customPlaces ?? []) {
          if (!places.some((p) => p.id === place.id)) {
            places.push(place)
            merged++
          }
        }
        set({ marks: current, places })
        return { merged }
      },
    }),
    {
      name: 'bando-map:user',
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as MarksState
        if (version < 2) state.marks = migrateV1Marks(state.marks ?? {})
        state.places ??= []
        return state
      },
    },
  ),
)

export function exportUserData(): UserData {
  const { marks, places } = useMarksStore.getState()
  return { version: 1, marks, customPlaces: places }
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
