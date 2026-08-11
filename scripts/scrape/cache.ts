/** Disk cache under data/cache/ so pipeline reruns don't re-hit the register. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const DIR = 'data/cache'

export async function cachedJson<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const path = `${DIR}/${key}.json`
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    const value = await fetcher()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value, null, 1))
    return value
  }
}
