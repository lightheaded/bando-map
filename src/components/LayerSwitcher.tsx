import { BASE_LAYERS, type BaseLayerId } from '../map/layers'
import { useAppStore } from '../state/store'

/**
 * Base-map choice, sitting on the map itself to the left of the zoom buttons
 * rather than in the sidebar — it changes what the map looks like, so it
 * belongs with the other map controls and stays reachable with the panel
 * collapsed or the mobile sheet shut.
 */
export function LayerSwitcher() {
  const baseLayer = useAppStore((s) => s.baseLayer)
  const setBaseLayer = useAppStore((s) => s.setBaseLayer)
  return (
    <div className="layer-switcher" role="radiogroup" aria-label="Base layer">
      {(Object.keys(BASE_LAYERS) as BaseLayerId[]).map((id) => (
        <button
          key={id}
          role="radio"
          aria-checked={baseLayer === id}
          className={baseLayer === id ? 'active' : ''}
          onClick={() => setBaseLayer(id)}
        >
          {BASE_LAYERS[id]}
        </button>
      ))}
    </div>
  )
}
