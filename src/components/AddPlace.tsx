import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { revealPlace } from '../state/filters'

// The add flow starts from the Contribute panel ("+ Add a place").
export function AddPlaceForm() {
  const placeDraft = useAppStore((s) => s.placeDraft)
  const setPlaceDraft = useAppStore((s) => s.setPlaceDraft)
  const select = useAppStore((s) => s.select)
  const showToast = useAppStore((s) => s.showToast)
  const addPlace = useMarksStore((s) => s.addPlace)
  const setMark = useMarksStore((s) => s.setMark)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  const open = typeof placeDraft === 'object'
  useEffect(() => {
    if (open) {
      setName('')
      setNotes('')
      nameRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const save = () => {
    if (!name.trim()) {
      nameRef.current?.focus()
      return
    }
    const id = addPlace({ name: name.trim(), lat: placeDraft.lat, lon: placeDraft.lon })
    if (notes.trim()) setMark(id, { comment: notes.trim() })
    setPlaceDraft(undefined)
    select(id)
    showToast(revealPlace(id) ? 'Place added — filters widened to show it' : 'Place added')
  }

  return (
    <div className="add-place-form" role="dialog" aria-label="Add place">
      <h3>New place</h3>
      <p className="coords-note">
        {placeDraft.lat.toFixed(6)}, {placeDraft.lon.toFixed(6)}
      </p>
      <input
        ref={nameRef}
        placeholder="Name *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <textarea placeholder="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="filter-actions">
        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
        <button className="btn" onClick={() => setPlaceDraft(undefined)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
