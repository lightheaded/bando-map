import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { mapStyle, applyBaseLayer } from './layers'
import { LayersControl } from './layersControl'
import {
  addHintLayers,
  etakFilter,
  hintFeatureCollection,
  hintHash,
  hintLayerId,
  hintPlaceComment,
  hintPopupHtml,
  hintSpotName,
  hintSpotProps,
  type HintProps,
} from './hints'
import {
  addZoneLayers,
  setZonesVisible,
  zoneFeatureCollection,
  zoneFilter,
  zonePopupHtml,
  ZONE_FILL_LAYER,
  ZONE_LINE_LAYER,
  ZONE_SOURCE,
  type ZoneFeatureProps,
} from './zones'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { useFilteredBandos, resolveBando, revealPlace } from '../state/filters'
import { syncHashToSelection } from '../state/deeplink'
import { HINT_SOURCES, PHOTO_URL, type Bando, type HintSourceId, type UserMark } from '../types'

const ESTONIA_BOUNDS: [number, number, number, number] = [21.5, 57.4, 28.3, 59.8]
const VIEW_KEY = 'bando-map:view'

/** The authority this layer defers to — linked from every zone popup. */
const ZONE_OFFICIAL_URL = 'https://utm.eans.ee/avm/'
const ZONE_ATTRIBUTION = `UAS zones: <a href="${ZONE_OFFICIAL_URL}" target="_blank" rel="noopener">EANS</a>`
/** Most restrictive first — decides which overlapping zone a click reports. */
const ZONE_RANK = ['prohibited', 'permission', 'caution', 'info'] as const

const isMobile = () => window.matchMedia('(max-width: 640px)').matches

/** Map padding that keeps points visible next to the sidebar / above the sheet. */
function panelPadding(): { top: number; left: number; right: number; bottom: number } {
  return isMobile()
    ? { top: 0, left: 0, right: 0, bottom: Math.round(window.innerHeight * 0.5) }
    : { top: 0, left: 380, right: 0, bottom: 0 }
}

/**
 * panelPadding, but only for the chrome actually covering the map right now —
 * the open sheet on mobile, the docked sidebar on desktop. Zero when they're
 * out of the way.
 */
function livePadding(): { top: number; left: number; right: number; bottom: number } {
  const { sheetOpen, sidebarCollapsed } = useAppStore.getState()
  const covered = isMobile() ? sheetOpen : !sidebarCollapsed
  return covered ? panelPadding() : { top: 0, left: 0, right: 0, bottom: 0 }
}

const withMargin = (p: { top: number; left: number; right: number; bottom: number }, m: number) => ({
  top: p.top + m,
  left: p.left + m,
  right: p.right + m,
  bottom: p.bottom + m,
})

/** Survives dev-server reloads and accidental refreshes. */
function savedView(): { center: [number, number]; zoom: number } | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? '')
  } catch {
    return undefined
  }
}

// new = red, shortlisted = blue, visited = green, rejected = gray
const statusColor = (mark?: UserMark) =>
  mark?.status === 'rejected'
    ? '#71717a'
    : mark?.visited
      ? '#059669'
      : mark?.status === 'shortlisted'
        ? '#2563eb'
        : '#e11d48'

// MapLibre positions the marker element with an inline transform, so the
// scalable button lives inside a wrapper div that MapLibre owns.
function buildPhotoMarkerEl(b: Bando): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'photo-marker-wrap'
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'photo-marker'
  el.title = b.name
  const thumb = b.thumbs?.find(Boolean)
  if (thumb) {
    el.style.backgroundImage = `url(${import.meta.env.BASE_URL}${thumb})`
  } else if (b.photos.length) {
    el.style.backgroundImage = `url(${PHOTO_URL(b.photos[0])})`
  } else {
    el.classList.add('no-photo')
    el.textContent = b.custom || b.community ? '★' : '▢'
  }
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    useAppStore.getState().select(b.id)
  })
  wrap.appendChild(el)
  return wrap
}

/**
 * Every spot the clustering leaves unclustered at the current zoom gets an
 * HTML marker with its photo thumbnail — density decides, not a zoom
 * threshold, so a lone spot shows its photo even on the whole-country view
 * while dense areas stay as numbered clusters until they split. Diffed in
 * place: existing markers are kept, stale ones removed.
 */
function syncPhotoMarkers(
  map: maplibregl.Map,
  markers: Map<number, maplibregl.Marker>,
  bandos: Bando[],
  marks: Record<number, UserMark>,
  selectedId: number | undefined,
) {
  const byId = new Map(bandos.map((b) => [b.id, b]))
  const wanted = new Map<number, Bando>()
  // Loaded-tile features at the current zoom; clusters carry point_count.
  for (const f of map.querySourceFeatures('bandos')) {
    const id = f.properties?.cluster ? undefined : f.properties?.id
    const b = id != null ? byId.get(Number(id)) : undefined
    if (b) wanted.set(b.id, b)
  }
  for (const [id, marker] of markers) {
    if (!wanted.has(id)) {
      marker.remove()
      markers.delete(id)
    }
  }
  for (const [id, b] of wanted) {
    let marker = markers.get(id)
    if (!marker) {
      marker = new maplibregl.Marker({ element: buildPhotoMarkerEl(b), anchor: 'center' })
        .setLngLat([b.lon, b.lat])
        .addTo(map)
      markers.set(id, marker)
    } else {
      marker.setLngLat([b.lon, b.lat]) // a Move fix may have shifted it
    }
    const wrap = marker.getElement()
    wrap.classList.toggle('selected', id === selectedId)
    ;(wrap.firstElementChild as HTMLElement).style.borderColor = statusColor(marks[id])
  }
}

/**
 * Hint popup: shareable (#h/… hash while open), with a one-click promotion to
 * a regular custom place — the place then flows through the normal edit /
 * contribute pipeline like any manual addition, with provenance in its note.
 */
function openHintPopup(map: maplibregl.Map, src: HintSourceId, props: HintProps) {
  const state = useAppStore.getState()
  const popup = new maplibregl.Popup({ maxWidth: '320px' })
    .setLngLat([props.lon, props.lat])
    .setHTML(hintPopupHtml(src, props, state.hintData[src]?.source ?? ''))
    .addTo(map)
  history.replaceState(null, '', hintHash(src, props))
  popup.on('close', () => syncHashToSelection())
  wireHintPhotoWheel(popup.getElement())
  popup.getElement()?.querySelector<HTMLButtonElement>('.hint-add')?.addEventListener('click', () => {
    const name = hintSpotName(src, props)
    const id = useMarksStore.getState().addPlace({ name, lat: props.lat, lon: props.lon })
    useMarksStore.getState().setMark(id, { comment: hintPlaceComment(src, props) })
    popup.remove()
    useAppStore.getState().select(id)
    const widened = revealPlace(id)
    useAppStore.getState().showToast(`Saved "${name}" as your place${widened ? ' — filters widened to show it' : ''}`, {
      label: 'Undo',
      onClick: () => useMarksStore.getState().removePlace(id),
    })
  })
}

/**
 * Let the wheel scroll the photo strip. The strip only overflows sideways, which
 * a vertical wheel gesture won't move on its own, and the popup sits inside the
 * map container — so an unhandled wheel would zoom the map instead. When there
 * is nothing to scroll the event is left alone, keeping zoom-over-popup intact.
 */
function wireHintPhotoWheel(root: HTMLElement | undefined) {
  const strip = root?.querySelector<HTMLElement>('.hint-photos')
  strip?.addEventListener(
    'wheel',
    (e) => {
      if (strip.scrollWidth <= strip.clientWidth) return
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (!delta) return
      e.preventDefault()
      e.stopPropagation()
      strip.scrollLeft += delta
    },
    { passive: false },
  )
}

function toGeoJSON(bandos: Bando[], marks: Record<number, UserMark>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: bandos.map((b) => ({
      type: 'Feature',
      id: Math.abs(b.id),
      geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
      properties: {
        id: b.id,
        visited: marks[b.id]?.visited ?? false,
        status: marks[b.id]?.status ?? 'new',
      },
    })),
  }
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | undefined>(undefined)
  const markersRef = useRef(new Map<number, maplibregl.Marker>())
  // Latest-props closure for map event handlers registered once on load.
  const syncMarkersRef = useRef(() => {})
  const [sourceReady, setSourceReady] = useState(false)
  const bandos = useFilteredBandos()
  const bandosRef = useRef(bandos)
  bandosRef.current = bandos
  const marks = useMarksStore((s) => s.marks)
  const baseLayer = useAppStore((s) => s.baseLayer)
  const select = useAppStore((s) => s.select)
  const selectedId = useAppStore((s) => s.selectedId)
  const filters = useAppStore((s) => s.filters)
  const placeDraft = useAppStore((s) => s.placeDraft)
  const moveTarget = useAppStore((s) => s.moveTarget)
  const pendingView = useAppStore((s) => s.pendingView)

  useEffect(() => {
    if (!containerRef.current) return
    const restored = savedView()
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(useAppStore.getState().baseLayer),
      ...(restored
        ? { center: restored.center, zoom: restored.zoom }
        : { bounds: ESTONIA_BOUNDS, fitBoundsOptions: { padding: 20 } }),
      attributionControl: {
        compact: true,
        customAttribution:
          `<a href="https://github.com/lightheaded/bando-map/blob/main/CHANGELOG.md" target="_blank">` +
          `Bando Map v${__APP_VERSION__}</a>`,
      },
      // North up, always — no rotation or tilt.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    mapRef.current = map
    ;(window as unknown as { __map: maplibregl.Map }).__map = map // debug/verification handle

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    })
    geolocate.on('error', () =>
      useAppStore.getState().showToast('Location unavailable — check location permissions for this browser'),
    )
    map.addControl(geolocate, 'top-right')
    // Last in the stack, so it sits directly under "show my location".
    map.addControl(new LayersControl(), 'top-right')

    const publishView = () => {
      const b = map.getBounds()
      const c = map.getCenter()
      useAppStore.getState().setMapView({
        bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
      })
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() }))
    }
    map.on('moveend', publishView)
    // 'zoom' catches the cluster→photo handover mid-gesture, 'moveend' pans,
    // and 'sourcedata' the async cluster recomputation after zoom/setData.
    map.on('zoom', () => {
      syncMarkersRef.current()
      useAppStore.getState().setMapZoom(map.getZoom())
    })
    map.on('moveend', () => syncMarkersRef.current())
    map.on('sourcedata', (e) => {
      if (e.sourceId === 'bandos' && e.isSourceLoaded) syncMarkersRef.current()
    })

    map.on('load', () => {
      publishView()
      map.addSource('bandos', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 13,
        // Roomy enough that two unclustered photo markers (52px) don't overlap.
        clusterRadius: 60,
      })
      setSourceReady(true)
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'bandos',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#e11d48',
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 30, 28],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      })
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'bandos',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 13,
          'text-font': ['Noto Sans Regular'],
        },
        paint: { 'text-color': '#fff' },
      })
      // Unclustered spots are photo markers (HTML, see syncPhotoMarkers) —
      // only clusters render as circles.

      // Airspace goes in first, so it sits under every point layer: it is
      // context for the spots, never something to click through them to.
      addZoneLayers(map, 'clusters', ZONE_ATTRIBUTION)
      map.on('click', ZONE_FILL_LAYER, (e) => {
        const state = useAppStore.getState()
        if (state.placeDraft || state.moveTarget != null) return
        const f = e.features?.[0]
        if (!f) return
        // Zones overlap heavily near airports; the click lands on the most
        // restrictive one rather than whichever happens to be drawn on top.
        const props = e.features!
          .map((hit) => hit.properties as ZoneFeatureProps)
          .sort((a, b) => ZONE_RANK.indexOf(a.sev) - ZONE_RANK.indexOf(b.sev))[0]
        new maplibregl.Popup({ closeButton: true, maxWidth: '320px' })
          .setLngLat(e.lngLat)
          .setHTML(zonePopupHtml(props, ZONE_OFFICIAL_URL))
          .addTo(map)
        e.preventDefault()
      })
      map.on('mouseenter', ZONE_FILL_LAYER, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', ZONE_FILL_LAYER, () => (map.getCanvas().style.cursor = ''))

      // Hint layers render beneath the clusters; clicking a hint point opens
      // a lightweight popup (hints are leads, not part of the triage flow).
      addHintLayers(map, 'clusters')
      for (const id of HINT_SOURCES) {
        map.on('click', hintLayerId(id), (e) => {
          const state = useAppStore.getState()
          if (state.placeDraft || state.moveTarget != null) return
          const f = e.features?.[0]
          if (!f) return
          openHintPopup(map, id, f.properties as HintProps)
          e.preventDefault()
        })
        map.on('mouseenter', hintLayerId(id), () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', hintLayerId(id), () => (map.getCanvas().style.cursor = ''))
      }

      // Admin review overlay: red = current position, green = proposed, a
      // dashed line between them. Empty until setReviewDiff populates it.
      map.addSource('review-diff', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'review-diff-line',
        type: 'line',
        source: 'review-diff',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [2, 2] },
      })
      map.addLayer({
        id: 'review-diff-points',
        type: 'circle',
        source: 'review-diff',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': ['match', ['get', 'role'], 'before', '#e11d48', '#059669'],
          'circle-radius': 9,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#fff',
        },
      })

      map.on('click', 'clusters', async (e) => {
        const state = useAppStore.getState()
        if (state.placeDraft || state.moveTarget != null) return
        const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
        const source = map.getSource('bandos') as maplibregl.GeoJSONSource
        const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id)
        // Center within the visible map area — with the sheet expanded, a
        // plain center would hide the split-apart dots behind it.
        map.easeTo({
          center: (feature.geometry as Point).coordinates as [number, number],
          zoom,
          padding: livePadding(),
        })
      })
      map.on('click', (e) => {
        // A hint-point click (preventDefault above) shouldn't also deselect.
        if (e.defaultPrevented) return
        const state = useAppStore.getState()
        // Move tool: the next tap is the corrected position.
        if (state.moveTarget != null) {
          const id = state.moveTarget
          const previousFix = useMarksStore.getState().marks[id]?.fix
          useMarksStore.getState().setMark(id, { fix: { lat: e.lngLat.lat, lon: e.lngLat.lng } })
          state.setMoveTarget(undefined)
          state.showToast('Position corrected', {
            label: 'Undo',
            onClick: () => useMarksStore.getState().setMark(id, { fix: previousFix }),
          })
          return
        }
        // Add-place mode: the next tap picks the location.
        if (state.placeDraft === 'picking') {
          state.setPlaceDraft({ lat: e.lngLat.lat, lon: e.lngLat.lng })
          return
        }
        if (state.placeDraft) return
        // Photo-marker clicks never reach here (stopPropagation) — a canvas
        // click outside any cluster means empty map, so deselect.
        const hits = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
        if (!hits.length) select(undefined)
      })
      map.on('mouseenter', 'clusters', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'clusters', () => (map.getCanvas().style.cursor = ''))
    })

    return () => {
      map.remove() // takes the marker DOM down with it
      markersRef.current.clear()
      syncMarkersRef.current = () => {}
      mapRef.current = undefined
    }
  }, [select])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady) return
    ;(map.getSource('bandos') as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJSON(bandos, marks))
  }, [bandos, marks, sourceReady])

  // Hint layers: fetch lazily when first enabled, then drive visibility,
  // data and the ETAK noise filter from state.
  const hintData = useAppStore((s) => s.hintData)
  useEffect(() => {
    // Fetch enabled layers' data right away — not gated on the map, so a slow
    // style load doesn't also delay the dataset download.
    for (const id of HINT_SOURCES) {
      if (filters.hints.includes(id) && !hintData[id]) useAppStore.getState().loadHint(id)
    }
    const map = mapRef.current
    if (!map || !sourceReady) return
    for (const id of HINT_SOURCES) {
      map.setLayoutProperty(hintLayerId(id), 'visibility', filters.hints.includes(id) ? 'visible' : 'none')
    }
    map.setFilter(hintLayerId('etak'), etakFilter(filters.etakMinM2, filters.etakMinDwell))
  }, [filters, hintData, sourceReady])

  // Airspace zones: fetch on first enable, then drive visibility and the
  // "affects flight below N m" cut from state.
  const zoneData = useAppStore((s) => s.zoneData)
  useEffect(() => {
    if (filters.zones && !zoneData) useAppStore.getState().loadZones()
    const map = mapRef.current
    if (!map || !sourceReady) return
    setZonesVisible(map, filters.zones)
    if (zoneData) {
      ;(map.getSource(ZONE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(zoneFeatureCollection(zoneData))
    }
    for (const id of [ZONE_FILL_LAYER, ZONE_LINE_LAYER]) {
      if (map.getLayer(id)) map.setFilter(id, zoneFilter(filters.zoneCeiling))
    }
  }, [filters.zones, filters.zoneCeiling, zoneData, sourceReady])

  // Hint deep link (#h/<src>/<id>): once the layer's data is in, zoom to the
  // spot and open its popup — the layer itself was enabled by applyHash.
  const pendingHint = useAppStore((s) => s.pendingHint)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady || !pendingHint) return
    const dataset = hintData[pendingHint.src]
    if (!dataset) return // loadHint is in flight; this effect re-runs when it lands
    useAppStore.getState().setPendingHint(undefined)
    const spot = dataset.spots.find((s) => s.id === pendingHint.id)
    map.jumpTo({ center: [pendingHint.lon, pendingHint.lat], zoom: 15 })
    if (spot) {
      openHintPopup(map, pendingHint.src, hintSpotProps(spot))
    } else {
      useAppStore.getState().showToast('That hint is not in the current dataset — showing its location')
    }
  }, [pendingHint, hintData, sourceReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady) return
    for (const id of HINT_SOURCES) {
      const dataset = hintData[id]
      if (!dataset) continue
      const source = map.getSource(hintLayerId(id)) as maplibregl.GeoJSONSource | undefined
      source?.setData(hintFeatureCollection(dataset))
    }
  }, [hintData, sourceReady])

  // Photo markers: re-sync when the data, marks or selection change; the map
  // event handlers above re-sync on zoom/pan via syncMarkersRef.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady) return
    syncMarkersRef.current = () => syncPhotoMarkers(map, markersRef.current, bandos, marks, selectedId)
    syncMarkersRef.current()
  }, [bandos, marks, selectedId, sourceReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) applyBaseLayer(map, baseLayer)
    else map.once('load', () => applyBaseLayer(map, baseLayer))
  }, [baseLayer])

  // Center the selected bando in the map area the detail panel leaves visible:
  // bottom sheet on mobile, right-docked panel on desktop.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady) return
    // Look in the full dataset, not the filtered view — deep links may point at
    // a bando the current filters exclude. Apply any manual position fix.
    const raw =
      useAppStore.getState().bandos.find((b) => b.id === selectedId) ??
      useMarksStore.getState().places.find((p) => p.id === selectedId)
    const bando = raw && resolveBando(raw as Bando, useMarksStore.getState().marks[selectedId!])
    if (bando) {
      map.easeTo({
        center: [bando.lon, bando.lat],
        zoom: Math.max(map.getZoom(), 14),
        padding: panelPadding(),
        duration: 500,
      })
    } else {
      map.easeTo({ padding: { top: 0, left: 0, right: 0, bottom: 0 }, duration: 300 })
    }
  }, [selectedId, sourceReady])

  // Frame the filtered result set whenever the filters change — but not on
  // mount, so a restored view (dev reload, refresh) isn't yanked away. Hint
  // toggles don't affect which bandos show, so they must not refit either.
  const bandoFilterKey = JSON.stringify([
    filters.usage,
    filters.condition,
    filters.county,
    filters.status,
    filters.minRating,
    filters.search,
  ])
  const filtersTouched = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady) return
    if (!filtersTouched.current) {
      filtersTouched.current = true
      return
    }
    // A selected place is the focus — don't yank the view away from it (e.g.
    // saving a new place widens the filters right after easing to the spot).
    if (useAppStore.getState().selectedId != null) return
    const pts = bandosRef.current
    if (!pts.length) return
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
    for (const b of pts) {
      if (b.lon < minLon) minLon = b.lon
      if (b.lon > maxLon) maxLon = b.lon
      if (b.lat < minLat) minLat = b.lat
      if (b.lat > maxLat) maxLat = b.lat
    }
    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      {
        padding: isMobile()
          ? { top: 70, left: 40, right: 40, bottom: 110 }
          : { top: 70, left: 430, right: 70, bottom: 70 },
        maxZoom: 14,
        duration: 600,
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandoFilterKey, sourceReady])

  // Admin review: draw the pin-move diff and frame it.
  const reviewDiff = useAppStore((s) => s.reviewDiff)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady) return
    const source = map.getSource('review-diff') as maplibregl.GeoJSONSource | undefined
    if (!source) return
    const features: Feature[] = []
    if (reviewDiff) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: reviewDiff.after },
        properties: { role: 'after' },
      })
      if (reviewDiff.before) {
        features.push(
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: reviewDiff.before },
            properties: { role: 'before' },
          },
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [reviewDiff.before, reviewDiff.after] },
            properties: {},
          },
        )
      }
      const points = [reviewDiff.after, ...(reviewDiff.before ? [reviewDiff.before] : [])]
      const lons = points.map((p) => p[0])
      const lats = points.map((p) => p[1])
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        // Extra margin beyond the panel padding, so neither diff point sits
        // clipped at the viewport edge.
        { padding: withMargin(panelPadding(), 40), maxZoom: 16, duration: 500 },
      )
    }
    source.setData({ type: 'FeatureCollection', features })
  }, [reviewDiff, sourceReady])

  // Deep link to a location that isn't in the dataset.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady || !pendingView) return
    map.jumpTo({ center: [pendingView.lon, pendingView.lat], zoom: 15 })
    useAppStore.getState().setPendingView(undefined)
  }, [pendingView, sourceReady])

  return (
    <div
      ref={containerRef}
      className={`map-container ${placeDraft === 'picking' || moveTarget != null ? 'picking' : ''}`}
    />
  )
}
