/**
 * Spain's UAS geographical zones for the Canary Islands -> data/zones-es.json.
 *
 * Source: the public ArcGIS services of ENAIRE, the Spanish air navigation
 * provider, behind its official drone map at https://drones.enaire.es. They
 * are unauthenticated but slow, and they often drop the TLS handshake, so the
 * browser never calls them: a scheduled workflow (.github/workflows/zones-es.yml)
 * runs this script and publishes the result on our own CDN, the same way the
 * Estonian copy is published by backend/zones.mjs.
 *
 * Six layers go into one file:
 *   - aero, infra, urban: the documented zone service (ED-318 fields), see
 *     https://aip.enaire.es/recursos/DESCARGAS/ZGUAS/servAIS_APIDOC.pdf
 *   - nature, birds: protected nature areas and bird protection areas (ZEPA),
 *     which the official map draws from a separate service
 *   - notam: the drone NOTAMs the official map draws, active and announced
 *
 * Every feature is converted to the schema of the Estonian copy (UasZoneProps
 * in src/types.ts), so the app draws and judges both with the same code.
 *
 * A layer that fails after all retries keeps its features from the previous
 * published copy (`--previous`), and its own `checkedAt` stays old. One flaky
 * service must not blank the whole map, and the app shows each layer's age.
 *
 * Usage: tsx scripts/zones-es.ts --out zones-es.json [--previous old.json]
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { UasZoneDataset, UasZoneProps } from '../src/types'

/** The Canary Islands with a margin for the oceanic zones around them. */
const BBOX = [-18.4, 27.5, -13.3, 29.5]

const ZG = 'https://servais.enaire.es/insigniads/rest/services/NSF_SRV/SRV_UAS_ZG_data_V2/MapServer'
const APP = 'https://servais.enaire.es/insignias/rest/services'

const LAYERS = {
  aero: `${ZG}/2`,
  infra: `${ZG}/0`,
  urban: `${ZG}/3`,
  nature: `${APP}/ENP/ENP_APP_Local_V4/MapServer/0`,
  birds: `${APP}/ENP/ENP_APP_Local_V4/MapServer/1`,
  notam: `${APP}/NOTAM/NOTAM_UAS_APP_V3/MapServer/1`,
} as const
type LayerKey = keyof typeof LAYERS

export const OFFICIAL_URL = 'https://drones.enaire.es/?locale=en'
// ENAIRE's conditions of use require naming ENAIRE as the rights holder.
const ATTRIBUTION = `UAS zones: <a href="${OFFICIAL_URL}" target="_blank" rel="noopener">© ENAIRE</a>`

const ATTEMPTS = 8
const TIMEOUT_MS = 45_000

type Feature = UasZoneDataset['features'][number]
type Raw = { geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }

// ---------- fetch ----------

/**
 * How far the server may simplify each layer's shapes, in degrees (1e-5 is
 * about 1 m). At full detail the bird areas alone are 22 MB. Airspace edges get
 * about 5 m; the nature and bird areas, whose outlines are long coastlines and
 * whose edges nobody can see from the ground, get about 20 m.
 */
const SIMPLIFY: Record<LayerKey, string> = {
  aero: '0.00005',
  infra: '0.00005',
  urban: '0.0002',
  nature: '0.0002',
  birds: '0.0002',
  notam: '0.00005',
}

/** One layer, all pages, simplified by the server and rounded to 6 decimals. */
async function queryLayer(url: string, simplify: string): Promise<Raw[]> {
  const out: Raw[] = []
  for (let offset = 0; ; ) {
    const q = new URLSearchParams({
      where: '1=1',
      geometry: BBOX.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      outSR: '4326',
      maxAllowableOffset: simplify,
      geometryPrecision: '6',
      resultOffset: String(offset),
      f: 'geojson',
    })
    const page = (await withRetries(() => getJson(`${url}/query?${q}`))) as {
      features?: Raw[]
      exceededTransferLimit?: boolean
      properties?: { exceededTransferLimit?: boolean }
      error?: { message?: string }
    }
    if (page.error || !Array.isArray(page.features)) throw new Error(page.error?.message ?? 'no features array')
    out.push(...page.features)
    const more = page.exceededTransferLimit ?? page.properties?.exceededTransferLimit
    if (!more || page.features.length === 0) return out
    offset += page.features.length
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
  throw last
}

// ---------- normalise ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** The source's HTML to plain text. The app escapes it and keeps the line breaks. */
export function plainText(html: unknown): string | undefined {
  if (typeof html !== 'string') return undefined
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) =>
      e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text && text !== '<Null>' ? text : undefined
}

const REASONS: Record<string, string> = {
  AIR_TRAFFIC: 'Air traffic',
  SENSITIVE: 'Sensitive',
  PRIVACY: 'Privacy',
  POPULATION: 'Population',
  NATURE: 'Nature',
  NOISE: 'Noise',
  FOREIGN_TERRITORY: 'Foreign territory',
  EMERGENCY: 'Emergency',
  OTHER: 'Other',
}

/** ED-318 spells it with a z; the app's schema uses the Estonian feed's s. */
function restriction(type: unknown): UasZoneProps['restriction'] {
  if (type === 'PROHIBITED') return 'PROHIBITED'
  if (type === 'REQ_AUTHORIZATION' || type === 'REQ_AUTHORISATION') return 'REQ_AUTHORISATION'
  return 'NO_RESTRICTION'
}

const metres = (v: unknown, uom: unknown) => {
  const n = Number(v) || 0
  return Math.round(String(uom).toUpperCase() === 'FT' ? n * 0.3048 : n)
}

const isoOrUndefined = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function zoneProps(p: Record<string, unknown>, layer: LayerKey): UasZoneProps {
  const id = String(p.identifier ?? p.OBJECTID)
  const start = isoOrUndefined(p.startDateTime)
  const end = isoOrUndefined(p.endDateTime)
  const message = plainText(p.message) ?? plainText(p.description)
  const conditions = plainText(p.restrictionConditions)
  return {
    id: `es-${layer}-${id}`,
    name: plainText(p.name) ?? id,
    restriction: restriction(p.type),
    reason: REASONS[String(p.reasons)] ?? String(p.reasons ?? 'Other'),
    lower: metres(p.lower, p.uom),
    upper: metres(p.upper, p.uom),
    lowerRef: String(p.lowerReference || 'AGL'),
    upperRef: String(p.upperReference || 'AGL'),
    permanent: !start && !end,
    ...(start || end ? { start, end } : {}),
    ...(message ? { message } : {}),
    ...(conditions ? { conditions } : {}),
    country: 'ES',
  }
}

/**
 * Nature areas and bird areas carry no ED-318 fields, only a site name, a band
 * and a remark. The remark of a bird area says plainly that it neither allows
 * nor forbids a flight, so it is filed as an advisory; a protected nature area
 * is filed as Nature, which the app treats as "permission needed" — national
 * and natural parks such as Teide need the park manager's authorisation.
 */
function natureProps(p: Record<string, unknown>, layer: 'nature' | 'birds'): UasZoneProps {
  const name = String(p.SITENAME ?? p.NOMBRE ?? p.SITECODE ?? p.OBJECTID)
  const message = plainText(p.REMARKS_TXT_en) ?? plainText(p.REMARKS_TXT)
  const contact = plainText(p.CONTACT ?? p.CONTACTO)
  return {
    id: `es-${layer}-${p.SITECODE ?? p.OBJECTID}`,
    name,
    restriction: 'NO_RESTRICTION',
    reason: layer === 'nature' ? 'Nature' : 'Birds',
    lower: Number(p.RESTRICCION_LOWER) || 0,
    upper: Number(p.RESTRICCION_UPPER) || 0,
    lowerRef: 'AGL',
    upperRef: 'AGL',
    permanent: true,
    ...(message ? { message } : {}),
    ...(contact ? { conditions: `Manager: ${contact}` } : {}),
    country: 'ES',
  }
}

/** "GND", "SFC", "00120M AGL", "02500FT AMSL", "FL495" -> metres and datum. */
export function notamLevel(item: unknown): { m: number; ref: string } {
  const s = String(item ?? '').trim().toUpperCase()
  if (!s || s === 'GND' || s === 'SFC') return { m: 0, ref: 'AGL' }
  const fl = /^FL\s*(\d+)/.exec(s)
  if (fl) return { m: Math.round(Number(fl[1]) * 100 * 0.3048), ref: 'AMSL' }
  const v = /^(\d+)\s*(M|FT)\s*(AGL|AMSL|MSL)?/.exec(s)
  if (!v) return { m: 0, ref: 'AGL' }
  const n = Number(v[1])
  return { m: Math.round(v[2] === 'FT' ? n * 0.3048 : n), ref: v[3] === 'AGL' ? 'AGL' : 'AMSL' }
}

/**
 * A drone NOTAM. RTCA activates a temporary restricted area, so it is filed as
 * one; WULW announces other UAS flying there, which is a warning, not a ban.
 * The message keeps the schedule (item D) because "active" in B/C may still
 * mean only some hours of each day.
 */
function notamProps(p: Record<string, unknown>): UasZoneProps {
  const lower = notamLevel(p.itemF)
  const upper = notamLevel(p.itemG)
  const start = typeof p.itemB === 'number' ? new Date(p.itemB).toISOString() : undefined
  const end = typeof p.itemC === 'number' ? new Date(p.itemC).toISOString() : undefined
  const schedule = plainText(p.itemD)
  const text = plainText(p.itemE)
  const name = String(p.notamId ?? p.OBJECTID)
  const area = plainText(p.areaSactaName)
  return {
    id: `es-notam-${name}`,
    name: area ? `NOTAM ${name} · ${area}` : `NOTAM ${name}`,
    restriction: p.qcode === 'RTCA' ? 'REQ_AUTHORISATION' : 'NO_RESTRICTION',
    reason: 'NOTAM',
    lower: lower.m,
    upper: upper.m,
    lowerRef: lower.ref,
    upperRef: upper.ref,
    permanent: false,
    start,
    end,
    message: [schedule ? `Hours (UTC): ${schedule}` : '', text ?? ''].filter(Boolean).join('\n'),
    country: 'ES',
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const roundCoords = (c: unknown): unknown =>
  Array.isArray(c) ? (typeof c[0] === 'number' ? (c as number[]).slice(0, 2).map(round6) : c.map(roundCoords)) : c

function toFeature(raw: Raw, layer: LayerKey): Feature | undefined {
  const g = raw.geometry
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return undefined
  const p = raw.properties ?? {}
  const properties =
    layer === 'notam' ? notamProps(p) : layer === 'nature' || layer === 'birds' ? natureProps(p, layer) : zoneProps(p, layer)
  return {
    type: 'Feature',
    geometry: { type: g.type, coordinates: roundCoords(g.coordinates) } as Feature['geometry'],
    properties: { ...properties, layer },
  }
}

/**
 * The ED-318 layers publish their texts in Spanish only. scripts/zones-es-en.json
 * holds an English line for each Spanish line, made once and committed, so the
 * run needs no translation service. A line that is not in the table stays in
 * Spanish inside `messageEn` and is logged, so somebody can add it. `message`
 * stays the Spanish original: the app shows it under the English, and the
 * severity rule reads it.
 */
const SPANISH_LAYERS = new Set<string>(['aero', 'infra', 'urban'])
const ENGLISH: Record<string, string> = JSON.parse(
  readFileSync(new URL('./zones-es-en.json', import.meta.url), 'utf8'),
)
const untranslated = new Set<string>()

function withEnglish(f: Feature): Feature {
  const p = f.properties
  if (!p.message || !SPANISH_LAYERS.has(p.layer ?? '')) return f
  const messageEn = p.message
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line
      const en = ENGLISH[line.trim()]
      if (en === undefined) untranslated.add(line.trim())
      return en ?? line
    })
    .join('\n')
  return { ...f, properties: { ...p, messageEn } }
}

/** A NOTAM that has ended is dropped here, so a stale copy cannot show it. */
const current = (f: Feature, now: number) => !f.properties.end || new Date(f.properties.end).getTime() > now

// ---------- main ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const out = arg('out') ?? 'zones-es.json'
  const previousPath = arg('previous')
  const previous: UasZoneDataset | undefined =
    previousPath && existsSync(previousPath) ? safeParse(readFileSync(previousPath, 'utf8')) : undefined
  const now = new Date()
  const layers: NonNullable<UasZoneDataset['layers']> = {}
  const features: Feature[] = []

  for (const key of Object.keys(LAYERS) as LayerKey[]) {
    try {
      const raw = await queryLayer(LAYERS[key], SIMPLIFY[key])
      const got = raw.map((r) => toFeature(r, key)).filter((f): f is Feature => !!f)
      features.push(...got)
      layers[key] = { checkedAt: now.toISOString(), count: got.length }
      console.log(`${key}: ${got.length} zones`)
    } catch (e) {
      const kept = previous?.features.filter((f) => f.properties.layer === key) ?? []
      features.push(...kept)
      layers[key] = { checkedAt: previous?.layers?.[key]?.checkedAt, count: kept.length, failed: true }
      console.error(`${key}: FAILED (${(e as Error).message}); kept ${kept.length} from the previous copy`)
    }
  }

  const live = features.filter((f) => current(f, now.getTime())).map(withEnglish)
  if (untranslated.size) {
    console.log(`::warning::${untranslated.size} Spanish line(s) have no English in scripts/zones-es-en.json`)
    for (const line of untranslated) console.log(`  ${line}`)
  }
  const hash = createHash('sha256').update(JSON.stringify(live)).digest('hex')
  const changed = hash !== previous?.hash
  const failed = Object.values(layers).filter((l) => l.failed).length
  const okTimes = Object.values(layers)
    .map((l) => l.checkedAt)
    .filter((t): t is string => !!t)
    .sort()
  const dataset: UasZoneDataset = {
    type: 'FeatureCollection',
    version: 1,
    fetchedAt: changed ? now.toISOString() : (previous?.fetchedAt ?? now.toISOString()),
    // The oldest layer decides: "checked 5 minutes ago" must not hide a layer
    // that has failed for a day.
    checkedAt: okTimes[0] ?? previous?.checkedAt ?? now.toISOString(),
    source: OFFICIAL_URL,
    attribution: ATTRIBUTION,
    hash,
    layers,
    features: live,
  }
  if (failed === Object.keys(LAYERS).length) {
    console.error('Every layer failed; not writing a new copy.')
    process.exit(1)
  }
  writeFileSync(out, JSON.stringify(dataset))
  console.log(`${live.length} zones, ${changed ? 'changed' : 'unchanged'}, ${failed} layer(s) failed -> ${out}`)
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: 'a' })
}

function safeParse(s: string): UasZoneDataset | undefined {
  try {
    return JSON.parse(s) as UasZoneDataset
  } catch {
    return undefined
  }
}

await main()
