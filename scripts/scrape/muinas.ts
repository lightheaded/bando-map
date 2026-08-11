/**
 * Client for the muinas.ee "XX sajandi arhitektuur" catalog.
 *
 * The search form POSTs filters which are stored in the PHP session;
 * pagination is then plain GETs that reuse the session cookie.
 */
import * as cheerio from 'cheerio'

const BASE = 'https://register.muinas.ee'
const SEARCH_URL = `${BASE}/public.php?menuID=architecture`
// Cloudflare in front of register.muinas.ee 520s plain tool UAs, so identify
// as a browser with a project suffix instead.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 bando-map-scraper'

export const USAGE = {
  'ei kasutata': 768,
  elumaja: 770,
  kasutusel: 758,
  koolimaja: 771,
  sakraalhoone: 774,
  tuletorn: 769,
} as const

export const CONDITION = {
  halb: 766,
  hea: 759,
  rahuldav: 767,
} as const

export interface ArchitectureRow {
  id: number
  name: string
  county: string
  municipality: string
  address: string
  period?: string
  photos: number[]
}

const delayMs = Number(process.env.SCRAPE_DELAY_MS ?? 3000)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Minimal cookie jar — the session lives in `_Host-PHPSESSID` and Cloudflare adds its own cookies. */
class Jar {
  private cookies = new Map<string, string>()
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

async function request(url: string, init: RequestInit, jar: Jar): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': USER_AGENT,
      ...(jar.header() ? { Cookie: jar.header() } : {}),
      ...init.headers,
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} -> HTTP ${res.status}`)
  jar.absorb(res)
  return res.text()
}

function parseRows(html: string): ArchitectureRow[] {
  const $ = cheerio.load(html)
  const rows: ArchitectureRow[] = []
  $('tr.hovergroup').each((_, tr) => {
    const idMatch = $(tr).attr('id')?.match(/^hovergroup(\d+)$/)
    if (!idMatch) return
    const id = Number(idMatch[1])
    const cells = $(tr)
      .find('td')
      .map((_, td) => $(td).text().trim())
      .get()
    if (cells.length < 6) return
    const photos = $(`tr.hiddenimagerow.hovergroup${id}`)
      .find('a[rel=lightbox]')
      .map((_, a) => Number($(a).attr('href')?.match(/regular\/(\d+)\.jpg/)?.[1]))
      .get()
      .filter((n) => Number.isFinite(n))
    rows.push({
      id,
      name: cells[1],
      county: cells[2],
      municipality: cells[3],
      address: cells[4],
      period: cells[5] || undefined,
      photos,
    })
  })
  return rows
}

function lastPage(html: string): number {
  // Links are HTML-escaped (&amp;page=2), so match on the ; too.
  const pages = [...html.matchAll(/[?&;]page=(\d+)/g)].map((m) => Number(m[1]))
  return Math.max(1, ...pages)
}

function totalCount(html: string): number | undefined {
  const m = html.match(/Kokku:\s*(\d+)/)
  return m ? Number(m[1]) : undefined
}

/** Run one filtered search and return all result rows across pages. */
export async function searchArchitecture(filter: { usage?: number; condition?: number }): Promise<ArchitectureRow[]> {
  // Establish a session, then POST the filter into it; pagination GETs reuse the session.
  const jar = new Jar()
  await request(SEARCH_URL, { method: 'GET' }, jar)
  await sleep(delayMs)

  const body = new URLSearchParams({
    county: '',
    parish: '',
    dating: '',
    milieuarea: '',
    usage: filter.usage?.toString() ?? '',
    condition: filter.condition?.toString() ?? '',
  })
  const first = await request(
    SEARCH_URL,
    { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    jar,
  )

  const rows = parseRows(first)
  const pages = lastPage(first)
  const total = totalCount(first)
  for (let page = 2; page <= pages; page++) {
    await sleep(delayMs)
    const html = await request(`${SEARCH_URL}&page=${page}`, { method: 'GET' }, jar)
    if (totalCount(html) !== total) throw new Error(`page ${page} lost the filter (Kokku changed) — session broke`)
    rows.push(...parseRows(html))
  }
  console.log(`  filter ${JSON.stringify(filter)}: ${rows.length} rows over ${pages} page(s), Kokku: ${total}`)
  if (total !== undefined && rows.length !== total) {
    throw new Error(`row count ${rows.length} does not match Kokku ${total}`)
  }
  return rows
}
