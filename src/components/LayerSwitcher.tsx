import { BASE_LAYERS, type BaseLayerId } from '../map/layers'
import { useAppStore } from '../state/store'

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
