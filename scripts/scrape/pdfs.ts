/**
 * Archive each record's register PDF (data/pdfs/<id>.pdf) and extract every
 * location signal printed in its ÜLDANDMED table:
 *
 *  - coordinates — either L-EST97 ("X: 6517722.1 Y: 670008.5", with :/=/no
 *    separator, any case, decimal comma or point) or geographic DMS
 *    ("X: 58 29’16’’ Y: 26 22’58’’");
 *  - the katastritunnus (cadastral number, NNNNN:NNN:NNNN), geocodable via
 *    In-ADS to parcel precision;
 *  - the street-level address, usually richer than the catalog row's
 *    village-only address.
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

export interface PdfSignals {
  /** Coordinates printed in the PDF (exact). */
  coords: PdfCoords | null
  /** Katastritunnus (cadastral number), e.g. "38301:002:0185". */
  cadastral: string | null
  /** Street-level address from the ÜLDANDMED table, county/parish parts dropped. */
  address: string | null
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

const num = (s: string) => Number(s.replace(',', '.'))

/** Must land in Estonia, or the PDF layout fooled the regex. */
const inEstonia = (lat: number, lon: number) => lat >= 57.3 && lat <= 60 && lon >= 21 && lon <= 28.5

/**
 * Printed coordinates. Estonian convention: X = northing (7 digits, 63…66…),
 * Y = easting (6 digits). Seen variants: "X: 6517722.1 Y: 670008.5",
 * "X=6525458, y=478132", "X: 6603220; Y 636652", "x 6476697,8 y 413709.7".
 */
function extractLest97(text: string): PdfCoords | null {
  const m = text.match(
    /(?<![\wõäöüÕÄÖÜ])X\s*[:=]?\s*(6[3-6]\d{5}(?:[.,]\d+)?)[\s\S]{0,12}?(?<![\wõäöüÕÄÖÜ])Y\s*[:=]?\s*([3-7]\d{5}(?:[.,]\d+)?)/i,
  )
  if (!m) return null
  const northing = num(m[1])
  const easting = num(m[2])
  const [lon, lat] = proj4(LEST97, 'WGS84', [easting, northing])
  if (!inEstonia(lat, lon)) return null
  return { lat, lon, lestX: easting, lestY: northing }
}

/**
 * Geographic degrees-minutes-seconds, e.g. "X: 58 29’16’’ Y: 26 22’58’’"
 * (X = latitude, Y = longitude in this notation). Second-level precision
 * is ~20–30 m — as good as a building geocode.
 */
function extractDms(text: string): PdfCoords | null {
  const dms = String.raw`(\d{2})\s*[°º]?\s*(\d{1,2})\s*[’'′´]\s*(\d{1,2}(?:[.,]\d+)?)`
  const m = text.match(
    new RegExp(
      String.raw`(?<![\wõäöüÕÄÖÜ])X\s*[:=]?\s*${dms}\s*[’'′´”"″]{0,2}\s*Y\s*[:=]?\s*${dms}`,
      'i',
    ),
  )
  if (!m) return null
  const lat = Number(m[1]) + Number(m[2]) / 60 + num(m[3]) / 3600
  const lon = Number(m[4]) + Number(m[5]) / 60 + num(m[6]) / 3600
  if (!inEstonia(lat, lon)) return null
  const [lestX, lestY] = proj4('WGS84', LEST97, [lon, lat])
  return { lat, lon, lestX: Math.round(lestX * 10) / 10, lestY: Math.round(lestY * 10) / 10 }
}

/**
 * The ÜLDANDMED "Aadress" row: value in the right-hand column of the layout
 * text. County/parish parts are dropped (both have been reformed since the
 * PDFs were written and only mislead In-ADS); the settlement + street stay.
 */
function extractAddress(text: string): string | null {
  const m = text.match(/^\s*Aadress(?:\s+ja(?:\s+katastritunnus)?)?\s*[:.]?[ \t]{2,}(.+)$/im)
  if (!m) return null
  const parts = m[1]
    .replace(/\bkatastri(?:tunnus|üksus)\b.*$/i, '')
    .replace(/\bKT:.*$/i, '')
    .split(',')
    .map((p) => p.trim().replace(/[.;:]+$/, ''))
    .filter((p) => p && !/maakond$/i.test(p) && !/vald\b/i.test(p) && !/maa$/i.test(p))
  return parts.length ? parts.join(', ') : null
}

function extractSignals(text: string): PdfSignals {
  return {
    coords: extractLest97(text) ?? extractDms(text),
    cadastral: text.match(/\b(\d{5}:\d{3}:\d{4})\b/)?.[1] ?? null,
    address: extractAddress(text),
  }
}

/**
 * Cached location signals for a record's PDF; null = the register has no PDF.
 * A transient download failure is NOT cached, so the next run retries it.
 */
export async function pdfSignals(recordId: number): Promise<PdfSignals | null> {
  const key = `pdfsignals/${recordId}`
  const hit = await readCachedJson<PdfSignals | null>(key)
  if (hit !== undefined) return hit
  const path = await ensurePdfFile(recordId)
  if (path === null) return null // transient failure — leave uncached for retry
  if (path === 'absent') {
    await writeCachedJson(key, null) // the register has no PDF; don't re-ask
    return null
  }
  // -layout keeps table columns on one line — several PDFs put the value in a
  // second column that plain mode detaches from its label.
  const { stdout } = await run('pdftotext', ['-layout', path, '-'])
  const signals = extractSignals(stdout)
  if (!signals.coords) console.warn(`  pdf ${recordId}: no coordinates found in text`)
  await writeCachedJson(key, signals)
  return signals
}
