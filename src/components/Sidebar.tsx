import { useEffect, useRef } from 'react'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { ChevronsLeftIcon, ChevronsRightIcon } from './icons'
import { FilterButton, FilterPanel } from './FilterBar'
import { OfflineButton, OfflinePanel } from './OfflinePanel'
import { StorageButton, StoragePanel } from './StoragePanel'
import { SyncButton, SyncPanel } from './SyncPanel'
import { ContributeButton, ContributePanel } from './ContributePanel'
import { AdminButton, AdminPanel } from './AdminPanel'
import { PlacesList, useInViewBandos } from './PlacesList'
import { DetailContent } from './DetailPanel'

const PEEK_HEIGHT = 56
const openHeight = () => Math.round(window.innerHeight * 0.62)

/**
 * The one panel: controls on top, then either the in-view list or the
 * selected place's details. Left dock on desktop, bottom sheet on mobile.
 *
 * The sheet has two states — peek (just the grabber bar) and open — and the
 * grabber bar is both tappable and draggable: swipe up/down anywhere on it to
 * open/close, following the finger and snapping on release. Selecting a place
 * opens the sheet; swiping it down keeps the selection (the bar shows its
 * name) so the map under the card stays fully visible.
 */
export function Sidebar() {
  const selectedId = useAppStore((s) => s.selectedId)
  const selectedName = useAppStore((s) => s.bandos.find((b) => b.id === s.selectedId)?.name)
  const placeName = useMarksStore((s) => s.places.find((p) => p.id === selectedId)?.name)
  const editedName = useMarksStore((s) => (selectedId != null ? s.marks[selectedId]?.edits?.name : undefined))
  const sheetOpen = useAppStore((s) => s.sheetOpen)
  const setSheetOpen = useAppStore((s) => s.setSheetOpen)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const count = useInViewBandos().length

  // Picking a spot on the collapsed map brings the panel back for the detail.
  useEffect(() => {
    if (selectedId != null) setCollapsed(false)
  }, [selectedId, setCollapsed])

  const asideRef = useRef<HTMLElement>(null)
  const drag = useRef<{ startY: number; startH: number; lastY: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  const onTouchStart = (e: React.TouchEvent) => {
    const el = asideRef.current
    if (!el) return
    // A drag suppresses the click that MAY follow its touchend — but if none
    // followed, don't let the stale flag swallow the next genuine tap.
    suppressClick.current = false
    const y = e.touches[0].clientY
    drag.current = { startY: y, startH: el.getBoundingClientRect().height, lastY: y, moved: false }
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current
    const el = asideRef.current
    if (!d || !el) return
    const y = e.touches[0].clientY
    d.lastY = y
    if (Math.abs(y - d.startY) > 6) d.moved = true
    if (!d.moved) return
    const h = Math.min(Math.max(d.startH + (d.startY - y), PEEK_HEIGHT), openHeight())
    el.classList.add('dragging')
    el.style.height = `${h}px`
  }

  const onTouchEnd = () => {
    const d = drag.current
    const el = asideRef.current
    drag.current = null
    if (!d || !el) return
    el.classList.remove('dragging')
    if (!d.moved) return // plain tap — the click handler toggles
    const h = el.getBoundingClientRect().height
    el.style.height = ''
    suppressClick.current = true
    const delta = d.startY - d.lastY // positive = swiped up
    setSheetOpen(Math.abs(delta) > 40 ? delta > 0 : h > (PEEK_HEIGHT + openHeight()) / 2)
  }

  const label = editedName ?? selectedName ?? placeName ?? `${count} in view`
  return (
    <>
      {/* Floats in the corner while the sidebar is away (desktop only). */}
      {collapsed && (
        <button className="sidebar-reveal" title="Show the panel" onClick={() => setCollapsed(false)}>
          <ChevronsRightIcon />
        </button>
      )}
      <aside ref={asideRef} className={`sidebar ${sheetOpen ? 'expanded' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <button
        className="sheet-handle"
        aria-label={sheetOpen ? 'Collapse panel' : 'Expand panel'}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          setSheetOpen(!sheetOpen)
        }}
      >
        <span className="grabber" aria-hidden="true" />
        <span className="sheet-label">
          {label} <span aria-hidden="true">{sheetOpen ? '▾' : '▴'}</span>
        </span>
      </button>
      <div className="sidebar-controls">
        <FilterButton />
        <button
          className="filter-button sidebar-collapse"
          title="Hide the panel — explore the full map"
          onClick={() => setCollapsed(true)}
        >
          <ChevronsLeftIcon />
        </button>
      </div>
      <FilterPanel />
      <div className="sidebar-body">{selectedId != null ? <DetailContent /> : <PlacesList />}</div>
      <ContributePanel />
      <OfflinePanel />
      <StoragePanel />
      <SyncPanel />
      <AdminPanel />
      <nav className="sidebar-tabs" aria-label="Contribute, downloads, storage and sync">
        <ContributeButton />
        <OfflineButton />
        <StorageButton />
        <SyncButton />
        <AdminButton />
      </nav>
      </aside>
    </>
  )
}
