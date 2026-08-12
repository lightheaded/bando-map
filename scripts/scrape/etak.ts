/**
 * ETAK ruins ("vare") from Maa-amet's topographic database via public WFS.
 *
 * The buildings layer e_401_hoone_ka classifies ruins as tyyp=40 (roofless,
 * walls at least partly standing, from aerial-photo interpretation). Two
 * derived properties make the 36k-point layer filterable:
 *  - m2: footprint area (most noise is sheds and collapsed outbuildings)
 *  - dwellM: distance to the nearest in-use dwelling (tyyp=10) — ruins on
 *    somebody's yard are not visitable, and roughly half sit within 50 m
 *    of an occupied house.
 *
 * License: Maa- ja Ruumiamet open-data license — derivatives and
 * redistribution allowed with attribution.
 */
import { cachedJson } from './cache.ts'
import { wgs84ToLest97 } from '../../src/geo/lest97.ts'
import type { HintLayerDataset, HintSpot } from '../../src/types.ts'

const WFS = 'https://gsavalik.envir.ee/geoserver/etak/ows'
const PAGE = 5000
const delayMs = Number(process.env.ETAK_DELAY_MS ?? 500)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface WfsFeature {
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
  properties: { etak_id?: number; ads_lahiaadress?: string | null }
}

async function fetchPage(cql: string, props: string, startIndex: number): Promise<WfsFeature[]> {
  const url =
    `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=etak:e_401_hoone_ka` +
    `&CQL_FILTER=${encodeURIComponent(cql)}&count=${PAGE}&startIndex=${startIndex}` +
    `&outputFormat=application/json&srsName=EPSG:4326&propertyName=${props}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ETAK WFS HTTP ${res.status} at startIndex=${startIndex}`)
  return ((await res.json()) as { features: WfsFeature[] }).features
}

/** All pages of one filtered query, each page disk-cached. */
async function fetchAll(cacheKey: string, cql: string, props: string): Promise<WfsFeature[]> {
  const all: WfsFeature[] = []
  for (let i = 0; ; i++) {
    const page = await cachedJson<WfsFeature[]>(`${cacheKey}-p${i}`, async () => {
      await sleep(delayMs)
      return fetchPage(cql, props, i * PAGE)
    })
    all.push(...page)
    if (page.length < PAGE) return all
  }
}

const outerRing = (f: WfsFeature): number[][] =>
  (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]) as number[][]

function centroid(ring: number[][]): { lat: number; lon: number } {
  const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) }
}

/** Shoelace area on L-EST97-projected vertices, m². */
function footprintM2(ring: number[][]): number {
  const pts = ring.map((p) => wgs84ToLest97(p[1], p[0]))
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.round(Math.abs(s) / 2)
}

/** Grid-bucketed nearest-neighbor index over dwelling centroids (100 m cells). */
const CELL = 100
const DWELL_CAP = 999

function buildDwellingGrid(dwellings: WfsFeature[]): Map<string, { x: number; y: number }[]> {
  const grid = new Map<string, { x: number; y: number }[]>()
  for (const f of dwellings) {
    const c = centroid(outerRing(f))
    const p = wgs84ToLest97(c.lat, c.lon)
    const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(p)
    else grid.set(key, [p])
  }
  return grid
}

function nearestDwellingM(grid: Map<string, { x: number; y: number }[]>, x: number, y: number): number {
  const cx = Math.floor(x / CELL)
  const cy = Math.floor(y / CELL)
  let best = Infinity
  for (let r = 0; r <= DWELL_CAP / CELL + 1; r++) {
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cy - r; j <= cy + r; j++) {
        if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue
        for (const p of grid.get(`${i}:${j}`) ?? []) {
          best = Math.min(best, Math.hypot(x - p.x, y - p.y))
        }
      }
    }
    // Points outside the searched rings are at least r*CELL away.
    if (best <= r * CELL) break
  }
  return Math.min(Math.round(best), DWELL_CAP)
}

export async function buildEtakLayer(): Promise<HintLayerDataset> {
  console.log('ETAK: fetching ruin footprints (tyyp=40)…')
  const ruins = await fetchAll('etak/vare', 'tyyp=40', 'shape,ads_lahiaadress,etak_id')
  console.log(`ETAK: ${ruins.length} ruins; fetching in-use dwellings (tyyp=10) for the isolation metric…`)
  const dwellings = await fetchAll('etak/dwellings', 'tyyp=10', 'shape')
  console.log(`ETAK: ${dwellings.length} dwellings; computing footprints and distances…`)

  const grid = buildDwellingGrid(dwellings)
  const spots: HintSpot[] = ruins.map((f) => {
    const ring = outerRing(f)
    const { lat, lon } = centroid(ring)
    const p = wgs84ToLest97(lat, lon)
    return {
      id: String(f.properties.etak_id ?? `${lat},${lon}`),
      lat,
      lon,
      address: f.properties.ads_lahiaadress ?? undefined,
      m2: footprintM2(ring),
      dwellM: nearestDwellingM(grid, p.x, p.y),
    }
  })

  return {
    version: 1,
    scrapedAt: new Date().toISOString(),
    source: 'Eesti topograafia andmekogu (ETAK), Maa- ja Ruumiamet, avaandmete litsents',
    spots,
  }
}
