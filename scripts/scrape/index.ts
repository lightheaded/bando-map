/**
 * POC scraper: fetch all "ei kasutata" + "halb" buildings from the muinas.ee
 * XX-century architecture catalog, geocode them, write public/data/bandos.json.
 *
 * Usage: npm run scrape          (set SCRAPE_DELAY_MS to tune politeness, default 3000)
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { searchArchitecture, USAGE, CONDITION } from './muinas.ts'
import { geocode } from './geocode.ts'
import type { Bando, BandoDataset } from '../../src/types.ts'

async function main() {
  console.log('Searching muinas.ee for unused buildings in poor condition…')
  const rows = await searchArchitecture({ usage: USAGE['ei kasutata'], condition: CONDITION.halb })
  if (rows.length < 50) throw new Error(`suspiciously few results (${rows.length}) — did the search form change?`)

  console.log(`Geocoding ${rows.length} addresses via In-ADS…`)
  const bandos: Bando[] = []
  const failures: string[] = []
  const precisionCounts: Record<string, number> = {}

  for (const row of rows) {
    const geo = await geocode(row.address, row.municipality, row.county)
    if (!geo) {
      failures.push(`${row.id} ${row.name} — ${row.address}, ${row.municipality}`)
      continue
    }
    precisionCounts[geo.precision] = (precisionCounts[geo.precision] ?? 0) + 1
    bandos.push({
      id: row.id,
      name: row.name,
      county: row.county,
      municipality: row.municipality,
      address: row.address,
      period: row.period,
      usage: 'ei kasutata',
      condition: 'halb',
      lat: geo.lat,
      lon: geo.lon,
      lestX: geo.lestX,
      lestY: geo.lestY,
      geocode: geo.precision,
      photos: row.photos,
    })
  }

  const dataset: BandoDataset = {
    version: 1,
    scrapedAt: new Date().toISOString(),
    source: 'https://register.muinas.ee/public.php?menuID=architecture (Muinsuskaitseamet, kultuurimälestiste register)',
    bandos,
  }

  await mkdir('public/data', { recursive: true })
  await writeFile('public/data/bandos.json', JSON.stringify(dataset, null, 1))

  console.log(`\nWrote public/data/bandos.json: ${bandos.length} bandos`)
  console.log('Geocode precision:', precisionCounts)
  if (failures.length) {
    console.log(`\n${failures.length} records could not be geocoded:`)
    for (const f of failures) console.log(`  - ${f}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
