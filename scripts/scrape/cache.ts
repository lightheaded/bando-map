/** Disk cache under data/cache/ so pipeline reruns don't re-hit the register. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const DIR = 'data/cache'

export async function cachedJson<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = await readCachedJson<T>(key)
  if (hit !== undefined) return hit
  const value = await fetcher()
  await writeCachedJson(key, value)
  return value
}

export async function readCachedJson<T>(key: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(`${DIR}/${key}.json`, 'utf8')) as T
  } catch {
    return undefined
  }
}

export async function writeCachedJson<T>(key: string, value: T): Promise<void> {
  const path = `${DIR}/${key}.json`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 1))
}
