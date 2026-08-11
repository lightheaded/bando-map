import { sourcesFor, tileUrl, type BaseLayerId } from '../map/layers'

/** Street-level detail; deeper zooms explode the tile count for little gain. */
export const MAX_SAVE_ZOOM = 16
/** Refuse absurd downloads — the UI asks the user to zoom in instead. */
export const MAX_SAVE_TILES = 4000
/** Rough per-tile size for the pre-download estimate, refined live during it. */
const EST_TILE_BYTES: Record<string, number> = { kaart: 15_000, foto: 35_000, hybriid: 8_000 }

const lonToX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z)
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

export interface AreaPlan {
  urls: string[]
  estBytes: number
  /** True when the area exceeds MAX_SAVE_TILES and can't be saved as-is. */
  tooBig: boolean
}

/**
 * Everything needed to keep the current view usable offline: all tiles of the
 * active base layer covering `bounds`, from the current zoom down to street
 * level (MAX_SAVE_ZOOM).
 */
export function planAreaSave(
  bounds: [number, number, number, number],
  currentZoom: number,
  layer: BaseLayerId,
): AreaPlan {
  const [w, s, e, n] = bounds
  const zFrom = Math.max(4, Math.floor(currentZoom))
  const urls: string[] = []
  let estBytes = 0
  for (const source of sourcesFor(layer)) {
    for (let z = zFrom; z <= MAX_SAVE_ZOOM; z++) {
      const x0 = lonToX(w, z)
      const x1 = lonToX(e, z)
      const y0 = latToY(n, z)
      const y1 = latToY(s, z)
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (urls.length > MAX_SAVE_TILES) return { urls, estBytes, tooBig: true }
          urls.push(tileUrl(source, z, x, y))
          estBytes += EST_TILE_BYTES[source]
        }
      }
    }
  }
  return { urls, estBytes, tooBig: false }
}

export interface SaveProgress {
  done: number
  total: number
  bytes: number
  failed: number
}

/**
 * Fetch URLs into a cache with live progress. Already-cached tiles are
 * skipped (their bytes still count, so the total reads true). Concurrency 6 —
 * roughly what the map itself does while panning.
 */
export async function downloadInto(
  cacheName: string,
  urls: string[],
  onProgress: (p: SaveProgress) => void,
  signal: AbortSignal,
): Promise<SaveProgress> {
  const cache = await caches.open(cacheName)
  const progress: SaveProgress = { done: 0, total: urls.length, bytes: 0, failed: 0 }
  const queue = [...urls]
  const worker = async () => {
    for (let url = queue.shift(); url && !signal.aborted; url = queue.shift()) {
      try {
        const hit = await cache.match(url)
        if (hit) {
          progress.bytes += Number(hit.headers.get('content-length')) || (await hit.clone().blob()).size
        } else {
          const res = await fetch(url, { signal })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          await cache.put(
            url,
            new Response(blob, {
              headers: { 'content-type': blob.type, 'content-length': String(blob.size) },
            }),
          )
          progress.bytes += blob.size
        }
      } catch {
        if (signal.aborted) return
        progress.failed++
      }
      progress.done++
      onProgress({ ...progress })
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return progress
}
