import type { StyleSpecification, RasterSourceSpecification } from 'maplibre-gl'

const TRACKING = 'ASUTUS=bando-map&KESKKOND=LIVE'
const ATTRIBUTION =
  'Kaart: <a href="https://geoportaal.maaamet.ee/" target="_blank">Maa-amet</a> · ' +
  'Andmed: <a href="https://register.muinas.ee/" target="_blank">Kultuurimälestiste register</a>'

function maaametSource(layer: string, ext: 'png' | 'jpg', minzoom: number): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [`https://tiles.maaamet.ee/tm/tms/1.0.0/${layer}/{z}/{x}/{y}.${ext}?${TRACKING}`],
    scheme: 'tms',
    tileSize: 256,
    minzoom,
    maxzoom: 18,
    attribution: ATTRIBUTION,
  }
}

export const BASE_LAYERS = {
  kaart: 'Kaart',
  foto: 'Orto',
  hybriid: 'Hübriid',
} as const

export type BaseLayerId = keyof typeof BASE_LAYERS

/**
 * All three Maa-amet base layers live in one style; switching toggles layer
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
    ],
  }
}

export function applyBaseLayer(map: maplibregl.Map, active: BaseLayerId) {
  map.setLayoutProperty('base-kaart', 'visibility', active === 'kaart' ? 'visible' : 'none')
  map.setLayoutProperty('base-foto', 'visibility', active !== 'kaart' ? 'visible' : 'none')
  map.setLayoutProperty('overlay-hybriid', 'visibility', active === 'hybriid' ? 'visible' : 'none')
}
