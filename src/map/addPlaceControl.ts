/**
 * The + button in the map's own top-right control stack, directly under
 * Layers. The add-place flow used to start only inside the Contribute panel,
 * where nothing on the map itself announced it — this control says on the map
 * that a missing spot can be added.
 *
 * A MapLibre IControl for the same reason as LayersControl: it inherits the
 * stack's spacing instead of being positioned against it.
 */
import type maplibregl from 'maplibre-gl'
import { useAppStore, toggleAddPlace } from '../state/store'

const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`

export class AddPlaceControl implements maplibregl.IControl {
  private container?: HTMLDivElement
  private unsubscribe?: () => void

  onAdd() {
    const container = document.createElement('div')
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'map-add-place'
    button.innerHTML = ICON
    button.addEventListener('click', () => toggleAddPlace())
    container.appendChild(button)

    // Active from the tap that starts the flow until the form closes, so the
    // control also reports a mode the Contribute panel can have started.
    const paint = (adding: boolean) => {
      button.classList.toggle('active', adding)
      button.setAttribute('aria-pressed', String(adding))
      const label = adding ? 'Cancel adding a place' : 'Add a place'
      button.title = label
      button.setAttribute('aria-label', label)
    }
    paint(useAppStore.getState().placeDraft != null)
    this.unsubscribe = useAppStore.subscribe((s) => paint(s.placeDraft != null))

    this.container = container
    return container
  }

  onRemove() {
    this.unsubscribe?.()
    this.container?.remove()
    this.container = undefined
  }
}
