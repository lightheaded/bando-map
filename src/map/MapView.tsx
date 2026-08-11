import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { mapStyle, applyBaseLayer } from './layers'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { useFilteredBandos, resolveBando } from '../state/filters'
import type { Bando, UserMark } from '../types'

const ESTONIA_BOUNDS: [number, number, number, number] = [21.5, 57.4, 28.3, 59.8]
const VIEW_KEY = 'bando-map:view'

const isMobile = () => window.matchMedia('(max-width: 640px)').matches

/** Map padding that keeps points visible next to the sidebar / above the sheet. */
function panelPadding(): { top: number; left: number; right: number; bottom: number } {
  return isMobile()
    ? { top: 0, left: 0, right: 0, bottom: Math.round(window.innerHeight * 0.5) }
    : { top: 0, left: 380, right: 0, bottom: 0 }
}

/** Survives dev-server reloads and accidental refreshes. */
function savedView(): { center: [number, number]; zoom: number } | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? '')
  } catch {
    return undefined
  }
}

// new = red, shortlisted = blue, visited = green, rejected = gray
const STATUS_COLOR = [
  'case',
  ['==', ['get', 'status'], 'rejected'],
  '#71717a',
  ['get', 'visited'],
  '#059669',
  ['==', ['get', 'status'], 'shortlisted'],
  '#2563eb',
  '#e11d48',
] as maplibregl.ExpressionSpecification

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
      attributionControl: { compact: true },
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    })
    geolocate.on('error', () =>
      useAppStore.getState().showToast('Location unavailable — check location permissions for this browser'),
    )
    map.addControl(geolocate, 'top-right')

    const publishView = () => {
      const b = map.getBounds()
      const c = map.getCenter()
      useAppStore.getState().setMapView({
        bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        center: [c.lng, c.lat],
      })
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() }))
    }
    map.on('moveend', publishView)

    map.on('load', () => {
      publishView()
      map.addSource('bandos', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 45,
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
      map.addLayer({
        id: 'bando-point',
        type: 'circle',
        source: 'bandos',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': STATUS_COLOR,
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      })
      map.addLayer({
        id: 'bando-selected',
        type: 'circle',
        source: 'bandos',
        filter: ['==', ['get', 'id'], -0.5],
        paint: {
          'circle-color': STATUS_COLOR,
          'circle-radius': 11,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#fbbf24',
        },
      })

      map.on('click', 'clusters', async (e) => {
        const state = useAppStore.getState()
        if (state.placeDraft || state.moveTarget != null) return
        const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
        const source = map.getSource('bandos') as maplibregl.GeoJSONSource
        const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id)
        map.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom })
      })
      map.on('click', 'bando-point', (e) => {
        const state = useAppStore.getState()
        if (state.placeDraft || state.moveTarget != null) return
        const id = e.features?.[0]?.properties?.id
        if (id != null) select(Number(id))
      })
      map.on('click', (e) => {
        const state = useAppStore.getState()
        // Move tool: the next tap is the corrected position.
        if (state.moveTarget != null) {
          useMarksStore.getState().setMark(state.moveTarget, { fix: { lat: e.lngLat.lat, lon: e.lngLat.lng } })
          state.setMoveTarget(undefined)
          state.showToast('Position corrected — use "Copy fixes" in filters to feed it back to the dataset')
          return
        }
        // Add-place mode: the next tap picks the location.
        if (state.placeDraft === 'picking') {
          state.setPlaceDraft({ lat: e.lngLat.lat, lon: e.lngLat.lng })
          return
        }
        if (state.placeDraft) return
        const hits = map.queryRenderedFeatures(e.point, { layers: ['clusters', 'bando-point'] })
        if (!hits.length) select(undefined)
      })
      for (const layer of ['clusters', 'bando-point']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }
    })

    return () => {
      map.remove()
      mapRef.current = undefined
    }
  }, [select])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady) return
    ;(map.getSource('bandos') as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJSON(bandos, marks))
  }, [bandos, marks, sourceReady])

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
    map.setFilter('bando-selected', ['==', ['get', 'id'], selectedId ?? -0.5])
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
  // mount, so a restored view (dev reload, refresh) isn't yanked away.
  const filtersTouched = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady) return
    if (!filtersTouched.current) {
      filtersTouched.current = true
      return
    }
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
  }, [filters, sourceReady])

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
