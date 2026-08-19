import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { revealPlace } from '../state/filters'

// The add flow starts from the map's + control or the Contribute panel's
// "+ Add a place" — both call toggleAddPlace, which puts the map in picking
// mode. A map tap sets the coordinates and opens this form.
/**
 * Picking mode says nothing on its own — the toast that starts it fades, and a
 * red button plus a crosshair cursor is thin evidence of what the map is now
 * waiting for. This card holds the instruction until a tap answers it, in the
 * slot the New place form takes over next.
 */
export function AddPlaceHint() {
  const picking = useAppStore((s) => s.placeDraft === 'picking')
  const setPlaceDraft = useAppStore((s) => s.setPlaceDraft)
  if (!picking) return null
  return (
    <div className="add-place-hint" role="status">
      <div>
        <strong>Adding a new place</strong>
        <span>Tap the map where the spot is.</span>
      </div>
      <button className="btn btn-small" onClick={() => setPlaceDraft(undefined)}>
        Cancel
      </button>
    </div>
  )
}

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
      <p className="retap-note">Tap the map again to move the pin.</p>
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
