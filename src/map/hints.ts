/**
 * Hint layers — supplementary sources rendered as small circles under the
 * curated bando markers. Leads for searches and manual triage: no user marks,
 * clicking one opens a lightweight popup (not the detail panel) that links the
 * source's own record and previews its photos where the source publishes them.
 * A hint can be promoted to a regular custom place from its popup.
 */
import maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { wgs84ToLest97 } from '../geo/lest97'
import {
  ESAP_THUMB_URL,
  GMAPS_URL,
  HINT_SOURCES,
  XGIS_URL,
  type HintLayerDataset,
  type HintSourceId,
  type HintSpot,
} from '../types'

export const HINT_STYLE: Record<HintSourceId, { label: string; color: string; attribution: string }> = {
  etak: { label: 'ETAK ruins', color: '#eab308', attribution: 'ETAK: <a href="https://geoportaal.maaruum.ee/" target="_blank">Maa- ja Ruumiamet</a>' },
  osm: { label: 'OSM ruins', color: '#f97316', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors' },
  esap: { label: 'Military heritage (ESAP)', color: '#a855f7', attribution: '<a href="https://teejuht.esap.ee/" target="_blank">Eesti sõjaajaloo teejuht (ESAP)</a>' },
  teadaanded: { label: 'Officially ownerless', color: '#14b8a6', attribution: '<a href="https://www.ametlikudteadaanded.ee/" target="_blank">Ametlikud Teadaanded</a>' },
}

export const hintLayerId = (id: HintSourceId) => `hint-${id}`

/** Direct link to the official Ehitisregister record (a generated PDF). */
const EHR_RECORD_URL = (code: string) => `https://livekluster.ehr.ee/api/document/v1/pdf/document/file/${code}`

/**
 * What `sourceUrl` points at, per source — named so the link says which record
 * it opens instead of a generic "Source". ETAK has no per-record page; its
 * lookup is the XGIS link every popup already carries.
 */
const SOURCE_LINK_LABEL: Record<HintSourceId, string> = {
  etak: 'Source',
  osm: 'OSM object',
  esap: 'ESAP record',
  teadaanded: 'Official notice',
}

/**
 * Resolves a source's photo ids to thumbnail URLs on the source's own server.
 * Only sources that publish photos have an entry.
 */
const THUMB_URL: Partial<Record<HintSourceId, (id: string, photo: string) => string>> = {
  esap: ESAP_THUMB_URL,
}

/** ETAK noise cuts (0 = off): min footprint m², min distance to an in-use dwelling. */
export function etakFilter(minM2: number, minDwell: number): maplibregl.FilterSpecification | null {
  const parts: unknown[] = []
  if (minM2 > 0) parts.push(['>=', ['get', 'm2'], minM2])
  if (minDwell > 0) parts.push(['any', ['!', ['has', 'dwellM']], ['>=', ['get', 'dwellM'], minDwell]])
  return parts.length ? (['all', ...parts] as unknown as maplibregl.FilterSpecification) : null
}

/**
 * Layers are added in HINT_SOURCES order, each one under `beforeId` — so the
 * last source ends up drawn on top. Click resolution (topHintHit) reads the
 * stack back off that same order.
 */
export function addHintLayers(map: maplibregl.Map, beforeId: string) {
  for (const id of HINT_SOURCES) {
    map.addSource(hintLayerId(id), {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      attribution: HINT_STYLE[id].attribution,
    })
    map.addLayer(
      {
        id: hintLayerId(id),
        type: 'circle',
        source: hintLayerId(id),
        layout: { visibility: 'none' },
        paint: {
          'circle-color': HINT_STYLE[id].color,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 12, 5, 16, 8],
          'circle-opacity': 0.9,
          'circle-stroke-width': 0.8,
          'circle-stroke-color': '#1e293b',
        },
      },
      beforeId,
    )
  }
}

/** The flattened feature-property shape (arrays JSON-encoded for MapLibre). */
export type HintProps = Omit<HintSpot, 'contact' | 'photos'> & { contact?: string; photos?: string }

export function hintSpotProps(s: HintSpot): HintProps {
  return {
    ...s,
    contact: s.contact ? JSON.stringify(s.contact) : undefined,
    photos: s.photos?.length ? JSON.stringify(s.photos) : undefined,
  }
}

export function hintFeatureCollection(dataset: HintLayerDataset): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: dataset.spots.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: hintSpotProps(s),
    })),
  }
}

/** Display name — every hint is identifiable, even the anonymous ETAK ruins. */
export function hintSpotName(src: HintSourceId, s: { id: string; name?: string; address?: string }): string {
  if (src === 'etak') return `ETAK vare #${s.id}`
  return s.name || s.address || `${HINT_STYLE[src].label} ${s.id}`
}

/** Shareable hash for a hint spot; ids pass through raw ("way/123" is hash-safe). */
export const hintHash = (src: HintSourceId, s: { id: string; lat: number; lon: number }) =>
  `#h/${src}/${s.id}@${s.lat.toFixed(6)},${s.lon.toFixed(6)}`

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * Popup body for a hint feature. Every link names a specific record: the
 * source's own page for the object (`sourceUrl`), the EHR building record, and
 * the map lookups for the coordinate. ETAK, the one source without per-record
 * pages, is looked up through the XGIS link.
 */
export function hintPopupHtml(src: HintSourceId, props: HintProps, attribution: string): string {
  const s = props
  const { x, y } = wgs84ToLest97(s.lat, s.lon)
  const lines: string[] = []
  lines.push(`<strong>${esc(hintSpotName(src, s))}</strong>`)
  if (s.address) lines.push(esc(s.address))
  if (s.m2 != null) lines.push(`Footprint ${s.m2} m² · nearest in-use dwelling ${s.dwellM === 999 ? '>999' : s.dwellM} m`)
  if (s.date) lines.push(`Notice date ${esc(s.date)}`)
  // Who to ask about the building before going (e.g. the announcing municipality).
  if (s.contact) {
    for (const line of JSON.parse(s.contact) as string[]) lines.push(esc(line))
  }
  const links = [
    s.sourceUrl
      ? `<a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(SOURCE_LINK_LABEL[src])}</a>`
      : '',
    s.ehr ? `<a href="${EHR_RECORD_URL(s.ehr)}" target="_blank" rel="noopener">EHR record</a>` : '',
    `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}" target="_blank" rel="noopener">Street View</a>`,
    `<a href="${GMAPS_URL(s.lat, s.lon)}" target="_blank" rel="noopener">Google Maps</a>`,
    `<a href="${XGIS_URL(x, y)}" target="_blank" rel="noopener">XGIS</a>`,
  ].filter(Boolean)
  return (
    `<div class="hint-popup">${lines.join('<br>')}` +
    hintPhotosHtml(src, s) +
    `<div class="hint-links">${links.join(' · ')}</div>` +
    `<button type="button" class="btn btn-small hint-add">＋ Save as place</button>` +
    `<div class="hint-source">${esc(attribution)}</div></div>`
  )
}

/**
 * Thumbnail strip for sources that publish photos (ESAP). Each thumbnail opens
 * the record page rather than the bare image — the caption and the rest of the
 * gallery live there. Images stay hot-linked from the source (never copied
 * here), with the referrer left intact so the source sees where the use is.
 */
function hintPhotosHtml(src: HintSourceId, s: HintProps): string {
  const thumbUrl = THUMB_URL[src]
  if (!s.photos || !thumbUrl) return ''
  const photos = JSON.parse(s.photos) as string[]
  if (!photos.length) return ''
  const href = s.sourceUrl ? ` href="${esc(s.sourceUrl)}" target="_blank" rel="noopener"` : ''
  const imgs = photos.map((p) => `<a${href}><img src="${esc(thumbUrl(s.id, p))}" loading="lazy" alt=""></a>`)
  return `<div class="hint-photos">${imgs.join('')}</div>`
}

/** The provenance note attached (as the user comment) when a hint becomes a place. */
export function hintPlaceComment(src: HintSourceId, props: HintProps): string {
  const parts = [`From hint layer: ${hintSpotName(src, props)}`]
  if (props.date) parts.push(`notice date ${props.date}`)
  if (props.contact) parts.push(...(JSON.parse(props.contact) as string[]))
  if (props.sourceUrl) parts.push(props.sourceUrl)
  if (props.ehr) parts.push(EHR_RECORD_URL(props.ehr))
  return parts.join('\n')
}
