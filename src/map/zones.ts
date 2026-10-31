/**
 * UAS geographical zones — drone-restriction airspace, drawn under everything
 * else as translucent polygons. Two copies feed it: data/zones.json for
 * Estonia, refreshed hourly by backend/zones.mjs from the feed behind
 * https://utm.eans.ee/avm/, and data/zones-es.json for the Canary Islands,
 * refreshed hourly by scripts/zones-es.ts from ENAIRE behind
 * https://drones.enaire.es.
 *
 * This is a triage aid, not a preflight briefing: it answers "is this spot
 * worth driving to" from the sofa. The popup links the official map on every
 * zone, and the panel shows how old our copy is.
 */
import maplibregl from 'maplibre-gl'
import type { UasZoneDataset, UasZoneProps } from '../types'

/** The open-category ceiling in metres AGL — the default "does this affect me" cut. */
export const OPEN_CATEGORY_CEILING = 120

/** The official map each copy defers to — linked from every zone popup. */
export const OFFICIAL_MAP = {
  EE: 'https://utm.eans.ee/avm/',
  ES: 'https://drones.enaire.es/?locale=en',
} as const

/** What the ENAIRE copy covers (W, S, E, N) — loaded only when the view reaches it. */
export const ES_COVERAGE: [number, number, number, number] = [-18.4, 27.5, -13.3, 29.5]

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
  // Spanish bird protection areas say outright that they neither allow nor
  // forbid a flight; the "it is prohibited to … disturb wild animals" in their
  // text is about the birds, and would otherwise trip the permission rule.
  if (p.reason === 'Birds') return 'caution'
  if (p.restriction === 'REQ_AUTHORISATION' || p.reason === 'Sensitive' || p.reason === 'Nature') return 'permission'
  if (DEMANDS_PERMISSION.test(message)) return 'permission'
  if (OPEN_CATEGORY.test(message)) return 'info'
  return 'caution'
}

/**
 * EANS files "Outside Estonia" (EERZout) as the whole globe with Estonia cut
 * out of it, so it is a red "No flight" over every other country — Tenerife
 * included. Its point is the border, so its outer ring is cut down to a box
 * around Estonia; the hole, which is the border itself, stays exact.
 */
const AROUND_ESTONIA: [number, number][] = [
  [17, 55],
  [17, 62.5],
  [32, 62.5],
  [32, 55],
  [17, 55],
]

function trimWorldRing(geometry: UasZoneDataset['features'][number]['geometry']) {
  if (geometry.type !== 'Polygon') return geometry
  const [outer, ...holes] = geometry.coordinates
  const lons = outer.map(([x]) => x)
  if (Math.max(...lons) - Math.min(...lons) < 359) return geometry
  return { type: 'Polygon' as const, coordinates: [AROUND_ESTONIA, ...holes] }
}

/** The flattened shape MapLibre carries; `sev` is computed here, never in the file. */
export type ZoneFeatureProps = UasZoneProps & { sev: ZoneSeverity }

/**
 * Severity is baked into the properties at load time rather than re-expressed
 * as a MapLibre `case` expression, so the paint and the popup can never drift
 * apart from `zoneSeverity` above.
 */
export function zoneFeatureCollection(datasets: (UasZoneDataset | undefined)[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: datasets
      .flatMap((d) => d?.features ?? [])
      // An offline copy outlives its NOTAMs; one that has ended is not drawn.
      .filter((f) => !f.properties.end || new Date(f.properties.end).getTime() > Date.now())
      .map((f) => ({
      type: 'Feature',
      geometry: trimWorldRing(f.geometry),
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
  // The Spanish "urban environment" zone is one polygon over the whole country
  // that says "check whether you are in a town". Drawn, it would paint every
  // field the same as a town centre, so it is never drawn: its text goes into
  // every popup inside the ENAIRE coverage instead (see urbanNote).
  return [
    'all',
    ['<', ['get', 'lower'], ceiling],
    ['!=', ['get', 'layer'], 'urban'],
  ] as unknown as maplibregl.FilterSpecification
}

/** The text of the never-drawn Spanish urban zone, for clicks inside its coverage. */
export function urbanNote(dataset: UasZoneDataset | undefined, lng: number, lat: number): string | undefined {
  const [w, s, e, n] = ES_COVERAGE
  if (!dataset || lng < w || lng > e || lat < s || lat > n) return undefined
  const urban = dataset.features.find((f) => f.properties.layer === 'urban')?.properties
  return urban?.messageEn ?? urban?.message
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
 * Order zones are reported in: most restrictive first. Overlapping airspace is
 * the norm near airports, so what the reader needs at the top is the rule that
 * actually stops them.
 */
export const ZONE_RANK: readonly ZoneSeverity[] = ['prohibited', 'permission', 'caution', 'info']

/**
 * Most-restrictive-first, one entry per distinct zone. A rendered query can
 * return the same polygon several times (it is split across tiles), and the
 * duplicates would otherwise repeat verbatim inside the popup.
 */
export function orderZones(zones: ZoneFeatureProps[]): ZoneFeatureProps[] {
  const seen = new Set<string>()
  const unique = zones.filter((z) => {
    const key = [z.name, z.lower, z.upper, z.reason, z.start, z.end].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.sort((a, b) => ZONE_RANK.indexOf(a.sev) - ZONE_RANK.indexOf(b.sev))
}

/**
 * One zone's block inside the popup. The published message is shown verbatim
 * and unabridged — for a temporary danger area or a nature zone it is the only
 * place the actual rule appears, and paraphrasing airspace rules is not this
 * app's business. A Spanish zone shows our line-by-line English first, and
 * ENAIRE's Spanish original folded under it.
 */
function zoneEntryHtml(p: ZoneFeatureProps): string {
  const sev = ZONE_SEVERITY[p.sev]
  const lines: string[] = [
    `<strong>${esc(p.name)}</strong> <span class="zone-tag" style="background:${sev.color}">${esc(sev.label)}</span>`,
    `${esc(band(p))} · ${esc(p.reason)}`,
  ]
  if (!p.permanent && (p.start || p.end)) {
    lines.push(`<em>Active ${esc(dayOf(p.start))} → ${esc(dayOf(p.end))}</em>`)
  }
  if (p.messageEn) {
    // The English is our translation; the Spanish is what ENAIRE published.
    lines.push(
      `<span class="zone-message">${esc(p.messageEn)}</span>`,
      `<details><summary>Original (Spanish)</summary><span class="zone-message">${esc(p.message ?? '')}</span></details>`,
    )
  } else if (p.message) lines.push(`<span class="zone-message">${esc(p.message)}</span>`)
  if (p.conditions) lines.push(`<span class="zone-message">${esc(p.conditions)}</span>`)
  return `<div class="zone-entry">${lines.join('<br>')}</div>`
}

/**
 * Popup for everything the click landed inside. Zones stack — a spot near an
 * airfield can sit in a CTR, a nature zone and an active danger area at once —
 * and reporting only the topmost hid rules the reader is equally bound by. So
 * every zone under the cursor gets its own block, most restrictive first, in
 * one scrollable popup; the count says how deep the stack is.
 *
 * `note` is the text of the never-drawn Spanish urban zone (see urbanNote). It
 * is the same long text at every point, so it stays folded. The links name the
 * official map of every country the stack comes from.
 */
export function zonePopupHtml(zones: ZoneFeatureProps[], note?: string): string {
  const ordered = orderZones(zones)
  const header =
    ordered.length > 1 ? `<div class="zone-count">${ordered.length} zones here</div>` : ''
  const entries = ordered.map(zoneEntryHtml)
  if (!ordered.length) entries.push('<div class="zone-entry"><strong>No mapped zone below this height</strong></div>')
  if (note) {
    entries.push(
      `<div class="zone-entry"><details><summary>Urban environment (ENAIRE)</summary>` +
        `<span class="zone-message">${esc(note)}</span></details></div>`,
    )
  }
  const countries = [...new Set(ordered.map((z) => z.country ?? 'EE'))]
  if (note && !countries.includes('ES')) countries.push('ES')
  const links = countries
    .map(
      (c) =>
        `<a href="${esc(OFFICIAL_MAP[c])}" target="_blank" rel="noopener">Official drone map${countries.length > 1 ? ` (${c})` : ''}</a>`,
    )
    .join(' · ')
  return (
    `<div class="zone-popup">${header}${entries.join('')}` +
    `<div class="zone-links">${links}</div>` +
    `<div class="zone-source">Always confirm on the official map and NOTAMs before flying.</div></div>`
  )
}
