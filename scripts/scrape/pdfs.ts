/**
 * Archive each record's register PDF (data/pdfs/<id>.pdf) and extract the
 * exact L-EST97 coordinates printed in it ("Koordinaadid X: <northing>
 * Y: <easting>") — far more precise than geocoding the address.
 *
 * Requires poppler's `pdftotext` on PATH (brew install poppler / apt install poppler-utils).
 * The PDFs also get uploaded to S3 so the app can link to them.
 */
import { mkdir, access, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import proj4 from 'proj4'
import { readCachedJson, writeCachedJson } from './cache.ts'
import { USER_AGENT } from './muinas.ts'

const run = promisify(execFile)
const PDF_DIR = 'data/pdfs'
const pdfDelayMs = Number(process.env.PDF_DELAY_MS ?? 2500)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// EPSG:3301 (L-EST97)
const LEST97 =
  '+proj=lcc +lat_1=59.33333333333334 +lat_2=58 +lat_0=57.51755393055556 +lon_0=24 +x_0=500000 +y_0=6375000 +ellps=GRS80 +units=m +no_defs'

export interface PdfCoords {
  lat: number
  lon: number
  /** Easting/northing, L-EST97. */
  lestX: number
  lestY: number
}

/** 'absent' = the register has no PDF for this record (404); null = transient failure. */
async function ensurePdfFile(recordId: number): Promise<string | 'absent' | null> {
  const path = `${PDF_DIR}/${recordId}.pdf`
  try {
    await access(path)
    return path
  } catch {
    // not downloaded yet
  }
  const res = await fetch(`https://register.muinas.ee/file/architecture/${recordId}.pdf`, {
    headers: { 'User-Agent': USER_AGENT },
  })
  await sleep(pdfDelayMs)
  if (res.status === 404) return 'absent'
  if (!res.ok) {
    console.warn(`  pdf ${recordId}: HTTP ${res.status}`)
    return null
  }
  await mkdir(PDF_DIR, { recursive: true })
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  return path
}

function extractFromText(text: string): PdfCoords | null {
  // Seen formats: "X: 6517722.1 Y: 670008.5" and "X=6598723 Y=602837".
  // Estonian convention: X = northing, Y = easting. Line breaks may intervene.
  const m = text.match(/X\s*[:=]\s*(\d{7}(?:[.,]\d+)?)[\s\S]{0,12}?Y\s*[:=]\s*(\d{6}(?:[.,]\d+)?)/)
  if (!m) return null
  const northing = Number(m[1].replace(',', '.'))
  const easting = Number(m[2].replace(',', '.'))
  const [lon, lat] = proj4(LEST97, 'WGS84', [easting, northing])
  // Sanity: must land in Estonia, or the PDF layout changed.
  if (lat < 57.3 || lat > 60 || lon < 21 || lon > 28.5) return null
  return { lat, lon, lestX: easting, lestY: northing }
}

/**
 * Cached PDF coordinates for a record. A missing/unfetchable PDF is NOT
 * cached, so the next run retries it; only actual extraction results
 * (including "this PDF has no coordinates") are cached.
 */
export async function pdfCoords(recordId: number): Promise<PdfCoords | null> {
  const key = `pdfcoords/${recordId}`
  const hit = await readCachedJson<PdfCoords | null>(key)
  if (hit !== undefined) return hit
  const path = await ensurePdfFile(recordId)
  if (path === null) return null // transient failure — leave uncached for retry
  if (path === 'absent') {
    await writeCachedJson(key, null) // the register has no PDF; don't re-ask
    return null
  }
  const { stdout } = await run('pdftotext', [path, '-'])
  const coords = extractFromText(stdout)
  if (!coords) console.warn(`  pdf ${recordId}: no coordinates found in text`)
  await writeCachedJson(key, coords)
  return coords
}
