/** Download a record's first photo and store a small local webp thumbnail. */
import { mkdir, access, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { USER_AGENT } from './muinas.ts'

const OUT_DIR = 'public/thumbs'
const imageDelayMs = Number(process.env.IMAGE_DELAY_MS ?? 1500)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Returns the app-relative thumb path, or undefined if the photo can't be fetched. */
export async function ensureThumb(recordId: number, photoId: number): Promise<string | undefined> {
  const rel = `thumbs/${recordId}.webp`
  const out = `public/${rel}`
  try {
    await access(out)
    return rel
  } catch {
    // not cached yet
  }

  const url = `https://register.muinas.ee/content/architecture/regular/${photoId}.jpg`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  await sleep(imageDelayMs)
  if (!res.ok) {
    console.warn(`  photo ${photoId} for record ${recordId}: HTTP ${res.status}`)
    return undefined
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(OUT_DIR, { recursive: true })
  const webp = await sharp(buf).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
  await writeFile(out, webp)
  return rel
}
