/** Storage accounting for the Offline panel — honest numbers, no guesses. */

export const CACHE_NAMES = {
  tiles: 'bando-tiles',
  photos: 'bando-photos',
  data: 'bando-data',
} as const

export interface CacheStats {
  count: number
  bytes: number
}

/**
 * Real cached bytes: content-length where the response carries it (tiles and
 * our own downloads always do), blob size otherwise. Cheap enough to run on
 * panel open.
 */
export async function cacheStats(name: string): Promise<CacheStats> {
  try {
    const cache = await caches.open(name)
    const keys = await cache.keys()
    let bytes = 0
    for (const req of keys) {
      const res = await cache.match(req)
      if (!res) continue
      bytes += Number(res.headers.get('content-length')) || (await res.clone().blob()).size
    }
    return { count: keys.length, bytes }
  } catch {
    return { count: 0, bytes: 0 }
  }
}

export async function clearCache(name: string): Promise<void> {
  await caches.delete(name)
}

export async function appShellBytes(): Promise<number> {
  let bytes = 0
  for (const name of await caches.keys()) {
    if (name.startsWith('workbox-precache')) bytes += (await cacheStats(name)).bytes
  }
  return bytes
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {}
  return { usage, quota }
}

export async function isPersisted(): Promise<boolean> {
  return (await navigator.storage?.persisted?.()) ?? false
}

export async function requestPersist(): Promise<boolean> {
  return (await navigator.storage?.persist?.()) ?? false
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
