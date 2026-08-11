import { useAppStore } from '../state/store'
import { LayerSwitcher } from './LayerSwitcher'
import { FilterButton, FilterPanel } from './FilterBar'
import { AddPlaceButton } from './AddPlace'
import { PlacesList, useInViewBandos } from './PlacesList'
import { DetailContent } from './DetailPanel'

/**
 * The one panel: controls on top, then either the in-view list or the
 * selected place's details. Left dock on desktop, bottom sheet on mobile.
 */
export function Sidebar() {
  const selectedId = useAppStore((s) => s.selectedId)
  const sheetOpen = useAppStore((s) => s.sheetOpen)
  const setSheetOpen = useAppStore((s) => s.setSheetOpen)
  const count = useInViewBandos().length

  const expanded = sheetOpen || selectedId != null
  return (
    <aside className={`sidebar ${expanded ? 'expanded' : ''}`}>
      <button
        className="sheet-handle"
        aria-label={expanded ? 'Collapse list' : 'Show list'}
        onClick={() => {
          if (selectedId != null) {
            // From detail, the handle goes back to the list, not to collapsed.
            useAppStore.getState().select(undefined)
            setSheetOpen(true)
          } else {
            setSheetOpen(!sheetOpen)
          }
        }}
      >
        <span className="grabber" aria-hidden="true" />
        {count} in view {expanded ? '▾' : '▴'}
      </button>
      <div className="sidebar-controls">
        <LayerSwitcher />
        <FilterButton />
        <AddPlaceButton />
      </div>
      <FilterPanel />
      <div className="sidebar-body">{selectedId != null ? <DetailContent /> : <PlacesList />}</div>
    </aside>
  )
}
