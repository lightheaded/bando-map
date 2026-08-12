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
import { mkdir, writeFile, readFile, access, stat } from 'node:fs/promises'
import { searchArchitecture, USAGE, CONDITION, type ArchitectureRow } from './muinas.ts'
import { geocode, geocodeCadastral, type GeocodeResult } from './geocode.ts'
import { ensureThumb } from './thumbs.ts'
import { pdfSignals } from './pdfs.ts'
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

/**
 * Manual corrections collected in the app ("Copy fixes"): coordinates from the
 * Move tool and/or register-field edits (name, address, period, usage,
 * condition) from the Edit tool, keyed by register id.
 */
async function readOverrides(): Promise<Record<string, Partial<Bando>>> {
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

  // Location ladder per record: coordinates printed in the register PDF, then
  // the PDF's katastritunnus resolved via In-ADS, then the best-precision
  // geocode of the PDF's street-level address vs the catalog address.
  const PRECISION_RANK = { building: 0, street: 1, village: 2 } as const
  const sourceCounts: Record<string, number> = {}
  for (const rec of candidates) {
    const signals = await pdfSignals(rec.id)
    let coords: Pick<Bando, 'lat' | 'lon' | 'lestX' | 'lestY'> | undefined
    let provenance: Bando['geocode'] | undefined
    let source: string
    if (signals?.coords) {
      coords = signals.coords
      provenance = 'register'
      source = 'pdf-coords'
    }
    if (!coords && signals?.cadastral) {
      const kt = await cachedJson<GeocodeResult | null>(`geocode-kt/${rec.id}`, async () => {
        return (await geocodeCadastral(signals.cadastral!, rec.county)) ?? null
      })
      if (kt) {
        coords = kt
        provenance = kt.precision
        source = 'pdf-cadastral'
      }
    }
    if (!coords) {
      const fromPdfAddr = signals?.address
        ? await cachedJson<GeocodeResult | null>(`geocode-pdfaddr/${rec.id}`, async () => {
            return (await geocode(signals.address!, rec.municipality, rec.county)) ?? null
          })
        : null
      const fromCatalog = geocoded.get(rec.id) ?? null
      // The PDF address must strictly beat the catalog geocode: extraction can
      // truncate it to the bare village, which In-ADS happily fuzzy-matches to
      // a same-named farm parcel at "building" precision somewhere else.
      const geo =
        fromPdfAddr && (!fromCatalog || PRECISION_RANK[fromPdfAddr.precision] < PRECISION_RANK[fromCatalog.precision])
          ? { hit: fromPdfAddr, source: 'pdf-address' }
          : fromCatalog
            ? { hit: fromCatalog, source: 'catalog-address' }
            : null
      if (geo) {
        coords = geo.hit
        provenance = geo.hit.precision
        source = geo.source
      }
    }
    if (!coords) {
      failures.push(`${rec.id} ${rec.name} — ${rec.address}, ${rec.municipality}`)
      continue
    }
    sourceCounts[source!] = (sourceCounts[source!] ?? 0) + 1
    const bando: Bando = {
      id: rec.id,
      name: rec.name,
      county: rec.county,
      municipality: rec.municipality,
      address: rec.address,
      period: rec.period,
      usage: rec.usage,
      condition: rec.condition,
      lat: coords.lat,
      lon: coords.lon,
      lestX: coords.lestX,
      lestY: coords.lestY,
      geocode: provenance!,
      photos: rec.photos,
    }
    const override = overrides[rec.id]
    if (override) {
      Object.assign(bando, override)
      // Only a coordinate override invalidates the geocode provenance (and the
      // L-EST97 pair) — field edits (name, address, …) leave them intact.
      if (override.lat != null || override.lon != null) {
        bando.geocode = 'manual'
        if (override.lestX == null) delete bando.lestX
        if (override.lestY == null) delete bando.lestY
      }
    }
    // Only records whose PDF is actually archived get a PDF link in the app —
    // a link to a missing object would hit the SPA fallback and open the map.
    bando.pdf = (await access(`data/pdfs/${rec.id}.pdf`).then(() => true, () => false)) || undefined
    if (rec.photos.length > 0) {
      bando.thumbs = []
      for (const [i, photoId] of rec.photos.entries()) {
        bando.thumbs.push((await ensureThumb(rec.id, photoId, i === 0)) ?? null)
      }
    }
    bandos.push(bando)
  }

  // Exact total thumbnail size — the app's "save all photos for offline"
  // states its download size before the user commits.
  let thumbsBytes = 0
  for (const b of bandos) {
    for (const t of b.thumbs ?? []) {
      if (t) thumbsBytes += await stat(`public/${t}`).then((s) => s.size, () => 0)
    }
  }

  const dataset: BandoDataset = {
    version: 1,
    scrapedAt: new Date().toISOString(),
    source: 'https://register.muinas.ee/public.php?menuID=architecture (Muinsuskaitseamet, kultuurimälestiste register)',
    thumbsBytes,
    bandos,
  }
  await mkdir('public/data', { recursive: true })
  await writeFile('public/data/bandos.json', JSON.stringify(dataset, null, 1))
  await writeFile('data/catalog.json', JSON.stringify({ scrapedAt: dataset.scrapedAt, records: catalog }, null, 1))

  console.log(`\nWrote public/data/bandos.json: ${bandos.length} bandos`)
  console.log(`Geocode precision (In-ADS):`, precisionCounts)
  console.log(`Coordinate source:`, sourceCounts)
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
