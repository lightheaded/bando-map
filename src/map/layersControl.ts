/**
 * The Layers button in the map's own top-right control stack, directly under
 * "show my location". A MapLibre IControl rather than an absolutely positioned
 * React element, so it inherits the stack's spacing and stays put if the
 * controls above it ever change height.
 *
 * It only opens and closes the menu — which layers are drawn is decided by the
 * checkboxes inside it, so the button never changes what is on the map.
 */
import type maplibregl from 'maplibre-gl'
import { useAppStore } from '../state/store'

const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polygon points="12 2 22 8.5 12 15 2 8.5 12 2"/><polyline points="2 15.5 12 22 22 15.5"/></svg>`

export class LayersControl implements maplibregl.IControl {
  private container?: HTMLDivElement
  private unsubscribe?: () => void

  onAdd() {
    const container = document.createElement('div')
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'map-layers-toggle'
    button.title = 'Layers'
    button.setAttribute('aria-label', 'Layers')
    button.innerHTML = ICON
    button.addEventListener('click', () => {
      const s = useAppStore.getState()
      s.setLayersPopover(!s.layersPopover)
    })
    container.appendChild(button)

    const paint = (open: boolean) => {
      button.classList.toggle('active', open)
      button.setAttribute('aria-expanded', String(open))
    }
    paint(useAppStore.getState().layersPopover)
    this.unsubscribe = useAppStore.subscribe((s) => paint(s.layersPopover))

    this.container = container
    return container
  }

  onRemove() {
    this.unsubscribe?.()
    this.container?.remove()
    this.container = undefined
  }
}
