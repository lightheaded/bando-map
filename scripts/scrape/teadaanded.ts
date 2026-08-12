/**
 * Officially ownerless buildings from Ametlikud Teadaanded — municipalities
 * must publish a notice ("peremehetu ehitise hõivamise teade") before taking
 * over an abandoned building, so these are the highest-signal spots we have.
 *
 * The site exposes a structured URI query, one XML document per year:
 *   /ee/-/kohaliku-elu-korraldamine/peremehetu-ehitise-hoivamine/{year}/xml
 * (results cap at 1000/query — annual volume is ~50-70, so a year never hits it).
 *
 * Notices carry no coordinates, only prose with an address and usually an
 * Ehitisregister code, so each is geocoded via In-ADS from extracted address
 * candidates. The announcing municipality's office contact + publication date
 * are kept per spot (so visitors can ask someone before going); last-known-
 * owner names stay in the linked notice and are not redistributed.
 */
import * as cheerio from 'cheerio'
import { cachedJson } from './cache.ts'
import { query, precisionOf, type InAdsAddress } from './geocode.ts'
import type { HintLayerDataset, HintSpot } from '../../src/types.ts'

const BASE = 'https://www.ametlikudteadaanded.ee/ee/-/kohaliku-elu-korraldamine/peremehetu-ehitise-hoivamine'
const FIRST_YEAR = 2003
const delayMs = Number(process.env.AT_DELAY_MS ?? 1000)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Notice {
  number: string
  url: string
  date: string // ISO yyyy-mm-dd
  publisher: string
  phone?: string
  email?: string
  body: string
  ehrCode?: string
}

async function fetchYearXml(year: number): Promise<string> {
  await sleep(delayMs)
  const res = await fetch(`${BASE}/${year}/xml`)
  if (!res.ok) throw new Error(`Ametlikud Teadaanded HTTP ${res.status} for ${year}`)
  return res.text()
}

function parseNotices(xml: string): Notice[] {
  const $ = cheerio.load(xml, { xmlMode: true })
  return $('at\\:teadaanne')
    .toArray()
    .map((el) => {
      const n = $(el)
      const field = (sel: string) => n.find(sel).first().text().trim()
      // kinnitatud_sisu is HTML-escaped markup — decode via text(), then strip tags.
      const body = cheerio.load(field('kinnitatud_sisu'))('body').text().replace(/\s+/g, ' ').trim()
      const [d, m, y] = field('avaldamise_kpv').split('.')
      return {
        number: field('teate_number'),
        url: field('url'),
        date: `${y}-${m}-${d}`,
        publisher: field('andmeandja > nimi'),
        phone: n.find('andmeandja_kontaktandmed > telefon').first().text().trim() || undefined,
        email: n.find('andmeandja_kontaktandmed > epost').first().text().trim() || undefined,
        body,
        ehrCode: body.match(/ehitisregistri koodi?g?a?:?\s*o?n?\s*(\d{6,12})/i)?.[1],
      }
    })
}

/**
 * Address candidates from notice prose, best-first: cadastral code, then
 * "aadressil X", then "<Name> külas/alevikus/…" with the locative -s dropped
 * so In-ADS recognizes the settlement.
 */
function addressCandidates(notice: Notice): string[] {
  const out: string[] = []
  const body = notice.body
  for (const m of body.matchAll(/\d{5}:\d{3}:\d{4}/g)) out.push(m[0])
  for (const m of body.matchAll(/aadressil\s+([^.;()]{4,80}?)(?:\s+asuva?| ja |[.;()])/gi)) out.push(m[1].trim())
  for (const m of body.matchAll(/([A-ZÕÄÖÜŠŽ][\wõäöüšž-]+(?:\s+[A-ZÕÄÖÜŠŽ]?[\wõäöüšž-]+)?)\s+(külas|alevikus|alevis|linnas)/g)) {
    out.push(`${m[1]} ${m[2].replace(/s$/, '')}`)
  }
  // Municipality context from the publisher ("X Vallavalitsus" → "X vald").
  const muni = notice.publisher.match(/^(.+?)\s+(Valla|Linna)valitsus/i)
  if (muni) {
    const suffix = muni[2].toLowerCase() === 'valla' ? 'vald' : 'linn'
    for (const c of [...out]) out.push(`${c}, ${muni[1]} ${suffix}`)
  }
  return [...new Set(out)]
}

interface Geo {
  lat: number
  lon: number
  precision: string
}

async function geocodeNotice(notice: Notice): Promise<Geo | null> {
  let village: Geo | null = null
  for (const candidate of addressCandidates(notice)) {
    let hits: InAdsAddress[]
    try {
      hits = await query(candidate)
    } catch {
      continue // transient gazetteer error — other candidates may still resolve
    }
    await sleep(300)
    const hit = hits[0]
    if (!hit) continue
    const geo = {
      lat: Number(hit.viitepunkt_b),
      lon: Number(hit.viitepunkt_l),
      precision: precisionOf(hit.liikVal),
    }
    if (geo.precision !== 'village') return geo
    village ??= geo
  }
  return village
}

export async function buildTeadaandedLayer(): Promise<HintLayerDataset> {
  console.log('Ametlikud Teadaanded: fetching peremehetu-ehitis notices…')
  const currentYear = new Date().getFullYear()
  const notices: Notice[] = []
  for (let year = FIRST_YEAR; year <= currentYear; year++) {
    // The running year keeps gaining notices — always fetch it live.
    const xml =
      year === currentYear
        ? await fetchYearXml(year)
        : await cachedJson<string>(`teadaanded/${year}`, () => fetchYearXml(year))
    notices.push(...parseNotices(xml))
  }
  console.log(`Ametlikud Teadaanded: ${notices.length} notices, geocoding…`)

  const spots: HintSpot[] = []
  let failed = 0
  for (const notice of notices) {
    const geo = await cachedJson<Geo | null>(`teadaanded/geo-${notice.number}`, () => geocodeNotice(notice))
    if (!geo) {
      failed++
      continue
    }
    spots.push({
      id: notice.number,
      name: 'Peremehetu ehitis (officially ownerless)',
      lat: geo.lat,
      lon: geo.lon,
      date: notice.date,
      contact: [notice.publisher, notice.phone, notice.email].filter((s): s is string => !!s),
      sourceUrl: notice.url,
      ehr: notice.ehrCode,
    })
  }
  console.log(`Ametlikud Teadaanded: ${spots.length} geocoded, ${failed} not geocodable (notice text only)`)

  return {
    version: 1,
    scrapedAt: new Date().toISOString(),
    source: 'Ametlikud Teadaanded, peremehetu ehitise hõivamise teated (ametlikudteadaanded.ee)',
    spots,
  }
}
