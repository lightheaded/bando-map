/**
 * Turn a chosen file into the two renders the API accepts, entirely in the
 * browser: a 1600px view copy and a 480px thumbnail, both re-encoded.
 *
 * The re-encode is the point. A canvas carries no metadata, so drawing the
 * decoded image and encoding it again drops every EXIF block — the GPS tag
 * where the photo was taken included — without us having to parse anything. It
 * also means the backend never decodes attacker-supplied pixels: it sniffs the
 * container header and moves bytes (see backend/handler.mjs). And it cuts a
 * 6 MB phone photo to ~200 KB before it ever leaves the device.
 */

export interface PreparedPhoto {
  /** Base64 without the data: prefix — what POST /photos expects. */
  full: string
  thumb: string
  ext: 'webp' | 'jpg'
  /** Pixel size of the full render, after any EXIF rotation was applied. */
  w: number
  h: number
  /** Byte size of the full render, for the "about to upload" line. */
  bytes: number
}

const FULL_WIDTH = 1600
const THUMB_WIDTH = 480
/**
 * Height bounds as well as width, because width alone doesn't bound the pixels:
 * a stitched vertical panorama of a tall building can be narrower than
 * FULL_WIDTH and still be enormous, and the API refuses anything over 4096 in
 * either direction. Scaling here means the user never meets that rejection.
 */
const FULL_HEIGHT = 3200
const THUMB_HEIGHT = 960
/** The API's caps are a little higher; the headroom absorbs base64 rounding. */
const FULL_MAX_BYTES = 400_000
const THUMB_MAX_BYTES = 70_000
/** Matches the register thumbnails the scraper writes (scripts/scrape/thumbs.ts). */
const QUALITIES = [0.82, 0.72, 0.62, 0.5]

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encoding failed'))), type, quality),
  )

/**
 * webp everywhere it encodes (every browser since Safari 16.4), JPEG otherwise —
 * asked once and remembered, because a canvas that cannot encode webp silently
 * hands back a PNG instead of failing, which would upload megabytes.
 */
let pickedType: Promise<'image/webp' | 'image/jpeg'> | undefined
function imageType() {
  pickedType ??= (async () => {
    const probe = document.createElement('canvas')
    probe.width = probe.height = 1
    const blob = await encode(probe, 'image/webp', 0.8).catch(() => undefined)
    return blob?.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
  })()
  return pickedType
}

/** Downscale to fit `width`×`height`, then encode as small as the caps demand. */
async function render(bitmap: ImageBitmap, width: number, height: number, maxBytes: number, type: string) {
  const scale = Math.min(1, width / bitmap.width, height / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d canvas')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  let blob = await encode(canvas, type, QUALITIES[0])
  for (const quality of QUALITIES.slice(1)) {
    if (blob.size <= maxBytes) break
    blob = await encode(canvas, type, quality)
  }
  // A photo of a facade at 1600px does not reach 400 KB at quality 0.5; if this
  // still trips, the image is pathological and the API would reject it anyway.
  if (blob.size > maxBytes) throw new Error('image will not compress small enough')
  return { blob, w: canvas.width, h: canvas.height }
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('could not read the encoded image'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(blob)
  })

/** Throws with a message meant for the user — the caller shows it as a toast. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('that file is not an image')
  // 'from-image' applies the EXIF orientation while decoding, so a portrait
  // phone photo does not arrive on its side once the tag is gone.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error("this browser can't read that image — try a JPEG or PNG")
  })
  try {
    const type = await imageType()
    const full = await render(bitmap, FULL_WIDTH, FULL_HEIGHT, FULL_MAX_BYTES, type)
    const thumb = await render(bitmap, THUMB_WIDTH, THUMB_HEIGHT, THUMB_MAX_BYTES, type)
    return {
      full: await toBase64(full.blob),
      thumb: await toBase64(thumb.blob),
      ext: type === 'image/webp' ? 'webp' : 'jpg',
      w: full.w,
      h: full.h,
      bytes: full.blob.size,
    }
  } finally {
    bitmap.close()
  }
}
