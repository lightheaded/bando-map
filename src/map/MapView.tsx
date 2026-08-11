import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { mapStyle, applyBaseLayer } from './layers'
import { useAppStore } from '../state/store'
import type { Bando } from '../types'

const ESTONIA_BOUNDS: [number, number, number, number] = [21.5, 57.4, 28.3, 59.8]

function toGeoJSON(bandos: Bando[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: bandos.map((b) => ({
      type: 'Feature',
      id: b.id,
      geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
      properties: { id: b.id },
    })),
  }
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | undefined>(undefined)
  const bandos = useAppStore((s) => s.bandos)
  const baseLayer = useAppStore((s) => s.baseLayer)
  const select = useAppStore((s) => s.select)

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
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      'top-right',
    )

    map.on('load', () => {
      map.addSource('bandos', {
        type: 'geojson',
        data: toGeoJSON(useAppStore.getState().bandos),
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 45,
      })
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
          'circle-color': '#e11d48',
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      })

      map.on('click', 'clusters', async (e) => {
        const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
        const source = map.getSource('bandos') as maplibregl.GeoJSONSource
        const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id)
        map.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom })
      })
      map.on('click', 'bando-point', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (id != null) {
          select(Number(id))
          map.easeTo({ center: (e.features![0].geometry as Point).coordinates as [number, number] })
        }
      })
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['clusters', 'bando-point'] })
        if (!hits.length) select(undefined)
      })
      for (const layer of ['clusters', 'bando-point']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }
    })

    return () => map.remove()
  }, [select])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const update = () => (map.getSource('bandos') as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJSON(bandos))
    if (map.isStyleLoaded()) update()
    else map.once('load', update)
  }, [bandos])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) applyBaseLayer(map, baseLayer)
    else map.once('load', () => applyBaseLayer(map, baseLayer))
  }, [baseLayer])

  return <div ref={containerRef} className="map-container" />
}
