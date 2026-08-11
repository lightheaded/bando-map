import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { mapStyle, applyBaseLayer } from './layers'
import { useAppStore } from '../state/store'
import { useMarksStore } from '../state/marks'
import { useFilteredBandos } from '../state/filters'
import type { Bando, UserMark } from '../types'

const ESTONIA_BOUNDS: [number, number, number, number] = [21.5, 57.4, 28.3, 59.8]

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
  const pendingView = useAppStore((s) => s.pendingView)

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(useAppStore.getState().baseLayer),
      bounds: ESTONIA_BOUNDS,
      fitBoundsOptions: { padding: 20 },
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

    map.on('load', () => {
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
        if (useAppStore.getState().placeDraft) return
        const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
        const source = map.getSource('bandos') as maplibregl.GeoJSONSource
        const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id)
        map.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom })
      })
      map.on('click', 'bando-point', (e) => {
        if (useAppStore.getState().placeDraft) return
        const id = e.features?.[0]?.properties?.id
        if (id != null) select(Number(id))
      })
      map.on('click', (e) => {
        const state = useAppStore.getState()
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
    // a bando the current filters exclude.
    const bando =
      useAppStore.getState().bandos.find((b) => b.id === selectedId) ??
      useMarksStore.getState().places.find((p) => p.id === selectedId)
    if (bando) {
      const isMobile = window.matchMedia('(max-width: 640px)').matches
      map.easeTo({
        center: [bando.lon, bando.lat],
        zoom: Math.max(map.getZoom(), 14),
        padding: isMobile
          ? { top: 0, left: 0, right: 0, bottom: Math.round(window.innerHeight * 0.5) }
          : { top: 0, left: 0, bottom: 0, right: 400 },
        duration: 500,
      })
    } else {
      map.easeTo({ padding: { top: 0, left: 0, right: 0, bottom: 0 }, duration: 300 })
    }
  }, [selectedId, sourceReady])

  // Frame the filtered result set whenever the filters change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady) return
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
      { padding: 70, maxZoom: 14, duration: 600 },
    )
  }, [filters, sourceReady])

  // Deep link to a location that isn't in the dataset.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sourceReady || !pendingView) return
    map.jumpTo({ center: [pendingView.lon, pendingView.lat], zoom: 15 })
    useAppStore.getState().setPendingView(undefined)
  }, [pendingView, sourceReady])

  return <div ref={containerRef} className={`map-container ${placeDraft === 'picking' ? 'picking' : ''}`} />
}
