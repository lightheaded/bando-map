/**
 * Estonian military-heritage objects from ESAP's Teejuht (teejuht.esap.ee).
 *
 * The guide embeds regional Google My Maps layers; each has a KML export.
 * Most placemark descriptions link the object's page in the ESAP database
 * (db.esap.ee/object/<slug>) — that page is the spot's id, source link, and
 * the place we scrape photo thumbnails from. Objects repeat across the
 * overlapping regional/thematic maps, so placemarks are deduplicated by
 * object slug when they have one, by rounded coordinate otherwise.
 *
 * Used in good faith with clear attribution — no license is published; if the
 * layer proves genuinely useful we contact the maintainers (Eesti Sõjamuuseum /
 * Ain Tähiste, Mart Mõniste) about a proper arrangement. See issue #1.
 */
import { cachedJson } from './cache.ts'
import { USER_AGENT } from './muinas.ts'
import type { HintLayerDataset, HintSpot } from '../../src/types.ts'

const TEEJUHT = 'https://teejuht.esap.ee/'
const OBJECT_URL = (slug: string) => `https://db.esap.ee/object/${slug}`
const delayMs = Number(process.env.ESAP_DELAY_MS ?? 1500)
/** Delay between db.esap.ee object-page fetches — ~2700 pages on a cold cache. */
const dbDelayMs = Number(process.env.ESAP_DB_DELAY_MS ?? 500)
/** Popup gallery cap; the source link leads to the full gallery. */
const MAX_PHOTOS = 6
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`ESAP HTTP ${res.status} for ${url}`)
  return res.text()
}

const unwrapCdata = (s: string) => s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim()

interface EsapObject {
  /** Canonical object name, often more precise than the KML placemark's. */
  title?: string
  /** Gallery thumbnail URLs, in page order. */
  photos: string[]
}

/** The object's db.esap.ee record; empty when the page can't be read. */
async function fetchObject(slug: string): Promise<EsapObject> {
  try {
    return await cachedJson<EsapObject>(`esap/object-${slug}`, async () => {
      await sleep(dbDelayMs)
      const html = await fetchText(OBJECT_URL(slug))
      const photos = [
        ...html.matchAll(/<img[^>]+src=['"](https:\/\/db\.esap\.ee\/uploads\/images\/thumb\/[^'"]+)['"]/g),
      ].map((m) => m[1])
      // Keep raw URLs in the cache; the layer stores tokens (thumbPhotoTokens).
      const title = html
        .match(/<title>(.*?)<\/title>/s)?.[1]
        .replace(/\s*-\s*Eesti Sõjaajaloo Andmebaas\s*$/, '')
        .trim()
      return { title: title || undefined, photos }
    })
  } catch (err) {
    console.warn(`ESAP: object page ${slug} failed: ${err instanceof Error ? err.message : err}`)
    return { photos: [] }
  }
}

/**
 * Gallery thumbnails are `thumb/<SLUG>_<photo>`, so the layer only stores the
 * `<photo>` part and ESAP_THUMB_URL rebuilds the URL in the app. The extension
 * stays in the token — a handful of galleries are .png. Anything off-pattern is
 * dropped with a warning rather than silently becoming a broken image.
 */
function thumbPhotoTokens(slug: string, urls: string[]): string[] {
  const photos: string[] = []
  for (const url of urls) {
    const photo = url.match(new RegExp(`/thumb/${slug.toUpperCase()}_(\\d+\\.\\w+)$`))?.[1]
    if (photo) photos.push(photo)
    else console.warn(`ESAP: unexpected thumbnail URL for ${slug}, skipped: ${url}`)
  }
  return photos
}

export async function buildEsapLayer(): Promise<HintLayerDataset> {
  console.log('ESAP: discovering Teejuht map layers…')
  const html = await cachedJson<string>('esap/teejuht-html', () => fetchText(TEEJUHT))
  const mids = [...new Set([...html.matchAll(/google\.com\/maps\/d\/[a-z]+\?mid=([A-Za-z0-9_-]+)/g)].map((m) => m[1]))]
  console.log(`ESAP: ${mids.length} My Maps layers`)

  const found: (HintSpot & { slug?: string; key: string })[] = []
  for (const mid of mids) {
    const kml = await cachedJson<string>(`esap/kml-${mid}`, async () => {
      await sleep(delayMs)
      return fetchText(`https://www.google.com/maps/d/kml?mid=${mid}&forcekml=1`)
    })
    const docName = unwrapCdata(kml.match(/<name>(.*?)<\/name>/s)?.[1] ?? mid)
    const placemarks = kml.match(/<Placemark>.*?<\/Placemark>/gs) ?? []
    for (const pm of placemarks) {
      const coord = pm.match(/<coordinates>\s*([-\d.]+),([-\d.]+)/)
      if (!coord) continue
      const lon = Number(Number(coord[1]).toFixed(6))
      const lat = Number(Number(coord[2]).toFixed(6))
      const slug = pm.match(/db\.esap\.ee\/object\/([a-z0-9-]+)/)?.[1]
      const name = unwrapCdata(pm.match(/<name>(.*?)<\/name>/s)?.[1] ?? '')
      // ~11 m grid — the same object placed on several regional maps.
      const key = `${lon.toFixed(4)},${lat.toFixed(4)}`
      found.push({
        slug,
        key,
        id: slug ?? key,
        name: name || undefined,
        lat,
        lon,
        contact: [`Teejuht layer: ${docName}`],
        sourceUrl: slug ? OBJECT_URL(slug) : undefined,
      })
    }
    console.log(`ESAP: ${docName} — ${placemarks.length} placemarks`)
  }

  // Objects repeat across the overlapping regional/thematic maps. Deduplicate by
  // slug where there is one, by coordinate otherwise — linked placemarks first, so
  // an unlinked copy of the same object loses to the one that names its record.
  const seen = new Set<string>()
  const spots: HintSpot[] = []
  for (const spot of [...found].sort((a, b) => Number(!!b.slug) - Number(!!a.slug))) {
    const { slug, key, ...rest } = spot
    if (seen.has(slug ?? key)) continue
    seen.add(slug ?? key)
    // Claim the coordinate too, so an unlinked copy is skipped, while two
    // distinct objects sharing a rounded coordinate both survive.
    if (slug) seen.add(key)
    spots.push(rest)
  }
  const linked = spots.filter((s) => s.sourceUrl)
  console.log(`ESAP: ${spots.length} unique spots, fetching ${linked.length} object records…`)

  let withPhotos = 0
  for (const [i, spot] of linked.entries()) {
    const object = await fetchObject(spot.id)
    if (object.title) spot.name = object.title
    const photos = thumbPhotoTokens(spot.id, object.photos)
    if (photos.length) {
      spot.photos = photos.slice(0, MAX_PHOTOS)
      withPhotos++
    }
    if ((i + 1) % 200 === 0) console.log(`ESAP: records ${i + 1}/${linked.length}`)
  }
  console.log(`ESAP: ${withPhotos}/${linked.length} spots with photos`)

  return {
    version: 1,
    scrapedAt: new Date().toISOString(),
    source: 'Eesti sõjaajaloo teejuht (teejuht.esap.ee), Eesti Sõjamuuseum / ESAP — kasutatud heas usus, viitega allikale',
    spots,
  }
}
