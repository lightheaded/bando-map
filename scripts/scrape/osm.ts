/**
 * Ruin/abandoned-tagged features in Estonia from OpenStreetMap via Overpass.
 *
 * One query per pipeline run (cached) is well within Overpass fair use.
 * License: ODbL. The layer is kept as its own dataset and never merged
 * record-by-record with other sources, so it stays a "collective database" —
 * attribution is required, share-alike stays contained to this file.
 */
import { cachedJson } from './cache.ts'
import type { HintLayerDataset, HintSpot } from '../../src/types.ts'

const OVERPASS = 'https://overpass-api.de/api/interpreter'
// Overpass 406s browser-like UAs — identify plainly as a tool instead.
const UA = 'bando-map-scraper (+https://bando.lagle.xyz)'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const QUERY = `
[out:json][timeout:120];
area["ISO3166-1"="EE"][admin_level=2]->.a;
(
  nwr["building"="ruins"](area.a);
  nwr["ruins"="yes"](area.a);
  nwr["abandoned"="yes"](area.a);
  nwr[~"^abandoned:building$"~"."](area.a);
);
out tags center;
`

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

function kindOf(tags: Record<string, string>): string {
  if (tags.building === 'ruins') return 'building=ruins'
  if (tags.ruins === 'yes') return 'ruins=yes'
  if (tags.abandoned === 'yes') return 'abandoned=yes'
  return 'abandoned:building'
}

export async function buildOsmLayer(): Promise<HintLayerDataset> {
  console.log('OSM: querying Overpass for ruin/abandoned tags in Estonia…')
  const elements = await cachedJson<OverpassElement[]>('osm/overpass', async () => {
    // The public instance sheds load with 429/504 — retry a few times.
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'User-Agent': UA },
        body: QUERY,
      })
      if (res.ok) return ((await res.json()) as { elements: OverpassElement[] }).elements
      if (attempt >= 4 || (res.status !== 429 && res.status !== 504)) {
        throw new Error(`Overpass HTTP ${res.status}`)
      }
      console.log(`OSM: Overpass HTTP ${res.status}, retrying in ${attempt * 30}s…`)
      await sleep(attempt * 30_000)
    }
  })

  const spots: HintSpot[] = []
  for (const el of elements) {
    const lat = el.center?.lat ?? el.lat
    const lon = el.center?.lon ?? el.lon
    if (lat == null || lon == null) continue
    const tags = el.tags ?? {}
    spots.push({
      id: `${el.type}/${el.id}`,
      name: tags.name ?? kindOf(tags),
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    })
  }
  console.log(`OSM: ${spots.length} spots`)

  return {
    version: 1,
    scrapedAt: new Date().toISOString(),
    source: '© OpenStreetMap contributors, ODbL — openstreetmap.org/copyright',
    spots,
  }
}
