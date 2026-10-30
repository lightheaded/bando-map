import type { StyleSpecification, RasterSourceSpecification } from 'maplibre-gl'

const TRACKING = 'ASUTUS=bando-map&KESKKOND=LIVE'
const ATTRIBUTION =
  'Kaart: <a href="https://geoportaal.maaamet.ee/" target="_blank">Maa-amet</a> · ' +
  'Andmed: <a href="https://register.muinas.ee/" target="_blank">Kultuurimälestiste register</a>'

/**
 * Where each national tile service has data (W, S, E, N). A raster source with
 * `bounds` requests no tile outside them, so both countries' layers can sit in
 * one style: in Estonia nothing asks Spain for a tile, and the other way round.
 */
const ESTONIA_TILES: [number, number, number, number] = [21.0, 57.2, 28.5, 60.0]
/** IGN covers the whole of Spain; the Canary Islands are the part the zones cover. */
const SPAIN_TILES: [number, number, number, number] = [-18.5, 27.4, 4.6, 44.0]

function maaametSource(layer: string, ext: 'png' | 'jpg', minzoom: number): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [`https://tiles.maaamet.ee/tm/tms/1.0.0/${layer}/{z}/{x}/{y}.${ext}?${TRACKING}`],
    scheme: 'tms',
    tileSize: 256,
    minzoom,
    maxzoom: 18,
    bounds: ESTONIA_TILES,
    attribution: ATTRIBUTION,
  }
}

const IGN_ATTRIBUTION = 'Mapa: <a href="https://www.ign.es/" target="_blank">© IGN España</a>'

/**
 * The Spanish counterparts, from IGN's open WMTS (CC BY 4.0). IGNBaseTodo is
 * the base map, PNOA the orthophoto, and IGNBaseOrto the transparent road and
 * label overlay that turns the orthophoto into a hybrid. CORS-clean, so the
 * offline save can fetch them like the Maa-amet tiles.
 */
const IGN = {
  'ign-kaart': { service: 'ign-base', layer: 'IGNBaseTodo', format: 'image/jpeg' },
  'ign-foto': { service: 'pnoa-ma', layer: 'OI.OrthoimageCoverage', format: 'image/jpeg' },
  'ign-hybriid': { service: 'ign-base', layer: 'IGNBaseOrto', format: 'image/png' },
} as const

function ignTemplate(id: keyof typeof IGN): string {
  const { service, layer, format } = IGN[id]
  return (
    `https://www.ign.es/wmts/${service}?layer=${layer}&style=default&tilematrixset=GoogleMapsCompatible` +
    `&Service=WMTS&Request=GetTile&Version=1.0.0&Format=${format}&TileMatrix={z}&TileCol={x}&TileRow={y}`
  )
}

function ignSource(id: keyof typeof IGN, minzoom: number): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [ignTemplate(id)],
    tileSize: 256,
    minzoom,
    maxzoom: 19,
    bounds: SPAIN_TILES,
    attribution: IGN_ATTRIBUTION,
  }
}

export const BASE_LAYERS = {
  kaart: 'Map',
  foto: 'Aerial',
  hybriid: 'Hybrid',
} as const

export type BaseLayerId = keyof typeof BASE_LAYERS

export type TileSourceId = 'kaart' | 'foto' | 'hybriid' | keyof typeof IGN

const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

/**
 * The tile sources a base-layer choice draws from ("hybriid" = orthophoto +
 * overlay). With `bounds`, only the countries that area touches — an offline
 * save of Tenerife fetches no Estonian tile.
 */
export function sourcesFor(active: BaseLayerId, bounds?: [number, number, number, number]): TileSourceId[] {
  const ee: TileSourceId[] = active === 'kaart' ? ['kaart'] : active === 'foto' ? ['foto'] : ['foto', 'hybriid']
  const es = ee.map((s) => `ign-${s}` as TileSourceId)
  if (!bounds) return [...ee, ...es]
  return [...(overlaps(bounds, ESTONIA_TILES) ? ee : []), ...(overlaps(bounds, SPAIN_TILES) ? es : [])]
}

/**
 * Concrete tile URL for offline downloads — the same URL MapLibre requests,
 * so the service worker cache hits. `y` is XYZ; Maa-amet is TMS, so flip.
 */
export function tileUrl(source: TileSourceId, z: number, x: number, y: number): string {
  if (source in IGN) {
    return ignTemplate(source as keyof typeof IGN)
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
  }
  const ext = source === 'foto' ? 'jpg' : 'png'
  const yTms = 2 ** z - 1 - y
  return `https://tiles.maaamet.ee/tm/tms/1.0.0/${source}@GMC/${z}/${x}/${yTms}.${ext}?${TRACKING}`
}

/**
 * All three Maa-amet base layers and their IGN counterparts live in one
 * style; switching toggles layer
 * visibility so tiles stay cached. "hybriid" is the orthophoto with the
 * hybrid label/road overlay on top.
 */
export function mapStyle(active: BaseLayerId): StyleSpecification {
  return {
    version: 8,
    // Default glyphs so the cluster count text layer can render.
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      kaart: maaametSource('kaart@GMC', 'png', 4),
      foto: maaametSource('foto@GMC', 'jpg', 6),
      hybriid: maaametSource('hybriid@GMC', 'png', 6),
      'ign-kaart': ignSource('ign-kaart', 4),
      'ign-foto': ignSource('ign-foto', 4),
      'ign-hybriid': ignSource('ign-hybriid', 4),
    },
    layers: [
      {
        id: 'base-kaart',
        type: 'raster',
        source: 'kaart',
        layout: { visibility: active === 'kaart' ? 'visible' : 'none' },
      },
      {
        id: 'base-foto',
        type: 'raster',
        source: 'foto',
        layout: { visibility: active !== 'kaart' ? 'visible' : 'none' },
      },
      {
        id: 'overlay-hybriid',
        type: 'raster',
        source: 'hybriid',
        layout: { visibility: active === 'hybriid' ? 'visible' : 'none' },
      },
      {
        id: 'base-ign-kaart',
        type: 'raster',
        source: 'ign-kaart',
        layout: { visibility: active === 'kaart' ? 'visible' : 'none' },
      },
      {
        id: 'base-ign-foto',
        type: 'raster',
        source: 'ign-foto',
        layout: { visibility: active !== 'kaart' ? 'visible' : 'none' },
      },
      {
        id: 'overlay-ign-hybriid',
        type: 'raster',
        source: 'ign-hybriid',
        layout: { visibility: active === 'hybriid' ? 'visible' : 'none' },
      },
    ],
  }
}

export function applyBaseLayer(map: maplibregl.Map, active: BaseLayerId) {
  map.setLayoutProperty('base-kaart', 'visibility', active === 'kaart' ? 'visible' : 'none')
  map.setLayoutProperty('base-foto', 'visibility', active !== 'kaart' ? 'visible' : 'none')
  map.setLayoutProperty('overlay-hybriid', 'visibility', active === 'hybriid' ? 'visible' : 'none')
  map.setLayoutProperty('base-ign-kaart', 'visibility', active === 'kaart' ? 'visible' : 'none')
  map.setLayoutProperty('base-ign-foto', 'visibility', active !== 'kaart' ? 'visible' : 'none')
  map.setLayoutProperty('overlay-ign-hybriid', 'visibility', active === 'hybriid' ? 'visible' : 'none')
}
