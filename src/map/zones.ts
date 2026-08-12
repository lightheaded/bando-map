/**
 * UAS geographical zones — Estonia's drone-restriction airspace, drawn under
 * everything else as translucent polygons. Data comes from data/zones.json,
 * refreshed hourly by backend/zones.mjs from the feed behind the official
 * drone map at https://utm.eans.ee/avm/.
 *
 * This is a triage aid, not a preflight briefing: it answers "is this spot
 * worth driving to" from the sofa. The popup links the official map on every
 * zone, and the panel shows how old our copy is.
 */
import maplibregl from 'maplibre-gl'
import type { UasZoneDataset, UasZoneProps } from '../types'

/** The open-category ceiling in metres AGL — the default "does this affect me" cut. */
export const OPEN_CATEGORY_CEILING = 120

export const ZONE_SOURCE = 'uas-zones'
export const ZONE_FILL_LAYER = 'uas-zones-fill'
export const ZONE_LINE_LAYER = 'uas-zones-line'

export type ZoneSeverity = 'prohibited' | 'permission' | 'caution' | 'info'

export const ZONE_SEVERITY: Record<ZoneSeverity, { label: string; color: string; blurb: string }> = {
  prohibited: { label: 'No flight', color: '#dc2626', blurb: 'Flying here is prohibited.' },
  permission: { label: 'Permission needed', color: '#f59e0b', blurb: 'Written permission or an authorisation is required.' },
  caution: { label: 'Caution', color: '#8b5cf6', blurb: 'Active or advisory — read the notice before flying.' },
  info: { label: 'Open category', color: '#0ea5e9', blurb: 'Open-category flight allowed within the stated height.' },
}

/**
 * Why this does not simply read `restriction`: the source files 145 of its 241
 * zones as NO_RESTRICTION while their message demands a written permission —
 * every "Sensitive" zone (Defence Forces, Police, Internal Security Service)
 * and every "Nature" zone (Environmental Board) among them. Trusting that field
 * would paint a military installation the same green as an empty field.
 *
 * So the rule leans on `reason` and on the published message, and anything it
 * cannot positively read as an open-category allowance falls to `caution`
 * rather than to `info` — the safe direction to be wrong in.
 *
 * Against the live feed this yields 217 "permission", 17 "open category", 6
 * "caution" and 1 "prohibited". The six really are advisories — paramotoring
 * and manned-aircraft training areas that say "operate UAS with caution" — and
 * every zone that names a permit-holder or an active danger area sorts above
 * them. The published message is shown verbatim in the popup regardless, so a
 * misread here costs the reader nothing but a glance.
 */
const DEMANDS_PERMISSION = new RegExp(
  [
    // Standing zones: the permit-holder is named in the message.
    'must have a permission',
    'must hold an authorisation',
    'authorisation must be obtained',
    'only take place under',
    // NOTAM-derived activations. These arrive filed as NO_RESTRICTION, and an
    // active danger or restricted area is not something to fly into on the
    // strength of a colour that said "caution".
    'danger area',
    'restricted area',
    'segregated area',
    'not permitted',
    'not allowed',
    'permission for entering',
    'is prohibited',
  ].join('|'),
  'i',
)
const OPEN_CATEGORY = /^\s*open category/i

export function zoneSeverity(p: UasZoneProps): ZoneSeverity {
  const message = p.message ?? ''
  if (p.restriction === 'PROHIBITED') return 'prohibited'
  if (p.restriction === 'REQ_AUTHORISATION' || p.reason === 'Sensitive' || p.reason === 'Nature') return 'permission'
  if (DEMANDS_PERMISSION.test(message)) return 'permission'
  if (OPEN_CATEGORY.test(message)) return 'info'
  return 'caution'
}

/** The flattened shape MapLibre carries; `sev` is computed here, never in the file. */
export type ZoneFeatureProps = UasZoneProps & { sev: ZoneSeverity }

/**
 * Severity is baked into the properties at load time rather than re-expressed
 * as a MapLibre `case` expression, so the paint and the popup can never drift
 * apart from `zoneSeverity` above.
 */
export function zoneFeatureCollection(dataset: UasZoneDataset): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: dataset.features.map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { ...f.properties, sev: zoneSeverity(f.properties) } satisfies ZoneFeatureProps,
    })),
  }
}

const severityColorExpr = [
  'match',
  ['get', 'sev'],
  ...(Object.keys(ZONE_SEVERITY) as ZoneSeverity[]).flatMap((s) => [s, ZONE_SEVERITY[s].color]),
  ZONE_SEVERITY.caution.color,
] as unknown as maplibregl.ExpressionSpecification

/**
 * Only zones whose floor is below the height you intend to fly at. A zone
 * banded 150-2900 m covers the whole country and means nothing to an FPV
 * pilot; without this cut the map is a solid wash.
 */
export function zoneFilter(ceiling: number): maplibregl.FilterSpecification {
  return ['<', ['get', 'lower'], ceiling] as unknown as maplibregl.FilterSpecification
}

export function addZoneLayers(map: maplibregl.Map, beforeId: string, attribution: string) {
  map.addSource(ZONE_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    attribution,
  })
  map.addLayer(
    {
      id: ZONE_FILL_LAYER,
      type: 'fill',
      source: ZONE_SOURCE,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': severityColorExpr,
        // Graded by severity, not flat. The nationwide "open category" zones
        // are the ones saying you MAY fly, and at an even opacity they wash out
        // the whole country and bury the few that actually stop you — ink goes
        // where the restriction is.
        'fill-opacity': [
          'match',
          ['get', 'sev'],
          'prohibited',
          0.22,
          'permission',
          0.2,
          'caution',
          0.14,
          'info',
          0.05,
          0.14,
        ] as unknown as maplibregl.ExpressionSpecification,
      },
    },
    beforeId,
  )
  map.addLayer(
    {
      id: ZONE_LINE_LAYER,
      type: 'line',
      source: ZONE_SOURCE,
      layout: { visibility: 'none' },
      paint: {
        'line-color': severityColorExpr,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 12, 1.6, 16, 2.4],
        // The outline carries the open-category zones instead of their fill, so
        // their extent stays readable without covering the map.
        'line-opacity': [
          'match',
          ['get', 'sev'],
          'info',
          0.55,
          0.85,
        ] as unknown as maplibregl.ExpressionSpecification,
      },
    },
    beforeId,
  )
}

export function setZonesVisible(map: maplibregl.Map, visible: boolean) {
  for (const id of [ZONE_FILL_LAYER, ZONE_LINE_LAYER]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  }
}

// ---------- freshness ----------

/** "4 minutes ago" / "2 hours ago" / "3 days ago" — the age of our copy, in words. */
export function relativeAge(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'unknown'
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Past this, the copy is called out in red with a nudge to refresh. */
export const STALE_AFTER_HOURS = 6

/**
 * Whether the copy is old enough to warn about. The fetcher runs hourly, so six
 * hours without a successful check means it has been failing for a while — an
 * early signal is the point, since a silently stale airspace picture is worse
 * than an alarm that turns out to be a blip.
 */
export const isStale = (checkedAt: string | undefined, now = Date.now()) =>
  !checkedAt || now - new Date(checkedAt).getTime() > STALE_AFTER_HOURS * 3600 * 1000

// ---------- popup ----------

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** "0-120 m AGL", collapsing the reference when both limits share one. */
function band(p: UasZoneProps): string {
  const refs = p.lowerRef === p.upperRef ? ` ${p.lowerRef}` : ''
  return refs
    ? `${p.lower}–${p.upper} m${refs}`
    : `${p.lower} m ${p.lowerRef} – ${p.upper} m ${p.upperRef}`
}

const dayOf = (iso?: string) => (iso ? iso.slice(0, 10) : '')

/**
 * Popup for one zone. The published message is shown verbatim and unabridged —
 * for a temporary danger area or a nature zone it is the only place the actual
 * rule appears, and paraphrasing airspace rules is not this app's business.
 */
export function zonePopupHtml(p: ZoneFeatureProps, sourceUrl: string): string {
  const sev = ZONE_SEVERITY[p.sev]
  const lines: string[] = [
    `<strong>${esc(p.name)}</strong> <span class="zone-tag" style="background:${sev.color}">${esc(sev.label)}</span>`,
    `${esc(band(p))} · ${esc(p.reason)}`,
  ]
  if (!p.permanent && (p.start || p.end)) {
    lines.push(`<em>Active ${esc(dayOf(p.start))} → ${esc(dayOf(p.end))}</em>`)
  }
  if (p.message) lines.push(`<span class="zone-message">${esc(p.message)}</span>`)
  if (p.conditions) lines.push(`<span class="zone-message">${esc(p.conditions)}</span>`)
  return (
    `<div class="zone-popup">${lines.join('<br>')}` +
    `<div class="zone-links">` +
    `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener">Official drone map</a>` +
    `</div>` +
    `<div class="zone-source">Always confirm on the official map and NOTAMs before flying.</div></div>`
  )
}
