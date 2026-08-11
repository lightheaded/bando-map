/**
 * Data pipeline for bando-map.
 *
 * 1. Scrape the full XX-century-architecture catalog from register.muinas.ee:
 *    one unfiltered query for the base records, then one query per usage and
 *    condition value to attribute those fields (the list view doesn't show them).
 * 2. Geocode candidate records (unused OR poor condition) via In-ADS.
 * 3. Apply manual coordinate overrides from data/overrides.json.
 * 4. Download a local webp thumbnail per candidate.
 * 5. Write public/data/bandos.json (candidates, for the app)
 *    and data/catalog.json (everything, for future phases).
 *
 * Reruns are cheap: raw results, geocodes, monuments and thumbnails are all
 * cached on disk. Delete data/cache/ (and public/thumbs/) for a fresh run.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { searchArchitecture, USAGE, CONDITION, type ArchitectureRow } from './muinas.ts'
import { geocode, type GeocodeResult } from './geocode.ts'
import { ensureThumb } from './thumbs.ts'
import { cachedJson } from './cache.ts'
import type { Bando, BandoDataset } from '../../src/types.ts'

interface CatalogRecord extends ArchitectureRow {
  usage?: string
  condition?: string
}

const isCandidate = (r: CatalogRecord) => r.usage === 'ei kasutata' || r.condition === 'halb'

async function buildCatalog(): Promise<CatalogRecord[]> {
  console.log('Scraping full catalog…')
  const base = await searchArchitecture({})
  const records = new Map<number, CatalogRecord>(base.map((r) => [r.id, { ...r }]))

  for (const [label, value] of Object.entries(USAGE)) {
    for (const row of await searchArchitecture({ usage: value })) {
      const rec = records.get(row.id) ?? records.set(row.id, { ...row }).get(row.id)!
      rec.usage = label
    }
  }
  for (const [label, value] of Object.entries(CONDITION)) {
    for (const row of await searchArchitecture({ condition: value })) {
      const rec = records.get(row.id) ?? records.set(row.id, { ...row }).get(row.id)!
      rec.condition = label
    }
  }
  return [...records.values()].sort((a, b) => a.id - b.id)
}

async function readOverrides(): Promise<Record<string, { lat: number; lon: number; lestX?: number; lestY?: number }>> {
  try {
    return JSON.parse(await readFile('data/overrides.json', 'utf8'))
  } catch {
    return {}
  }
}

async function main() {
  const catalog = await buildCatalog()
  const candidates = catalog.filter(isCandidate)
  console.log(`Catalog: ${catalog.length} records, ${candidates.length} candidates (unused or poor condition)`)

  console.log('Geocoding candidates…')
  const geocoded = new Map<number, GeocodeResult | null>()
  const precisionCounts: Record<string, number> = {}
  for (const rec of candidates) {
    const geo = await cachedJson<GeocodeResult | null>(`geocode/${rec.id}`, async () => {
      return (await geocode(rec.address, rec.municipality, rec.county)) ?? null
    })
    geocoded.set(rec.id, geo)
    if (geo) precisionCounts[geo.precision] = (precisionCounts[geo.precision] ?? 0) + 1
  }

  console.log('Ensuring thumbnails…')
  const bandos: Bando[] = []
  const failures: string[] = []
  const overrides = await readOverrides()

  for (const rec of candidates) {
    const geo = geocoded.get(rec.id)
    if (!geo) {
      failures.push(`${rec.id} ${rec.name} — ${rec.address}, ${rec.municipality}`)
      continue
    }
    const bando: Bando = {
      id: rec.id,
      name: rec.name,
      county: rec.county,
      municipality: rec.municipality,
      address: rec.address,
      period: rec.period,
      usage: rec.usage,
      condition: rec.condition,
      lat: geo.lat,
      lon: geo.lon,
      lestX: geo.lestX,
      lestY: geo.lestY,
      geocode: geo.precision,
      photos: rec.photos,
    }
    const override = overrides[rec.id]
    if (override) {
      Object.assign(bando, override)
      bando.geocode = 'manual'
    }
    if (rec.photos.length > 0) {
      bando.thumb = await ensureThumb(rec.id, rec.photos[0])
    }
    bandos.push(bando)
  }

  const dataset: BandoDataset = {
    version: 1,
    scrapedAt: new Date().toISOString(),
    source: 'https://register.muinas.ee/public.php?menuID=architecture (Muinsuskaitseamet, kultuurimälestiste register)',
    bandos,
  }
  await mkdir('public/data', { recursive: true })
  await writeFile('public/data/bandos.json', JSON.stringify(dataset, null, 1))
  await writeFile('data/catalog.json', JSON.stringify({ scrapedAt: dataset.scrapedAt, records: catalog }, null, 1))

  console.log(`\nWrote public/data/bandos.json: ${bandos.length} bandos`)
  console.log(`Geocode precision:`, precisionCounts)
  console.log(`Full catalog in data/catalog.json: ${catalog.length} records`)
  if (failures.length) {
    console.log(`\n${failures.length} candidates could not be geocoded (add to data/overrides.json):`)
    for (const f of failures) console.log(`  - ${f}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
