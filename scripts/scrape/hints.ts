/**
 * Hint-layer pipeline — supplementary sources beside the curated register
 * dataset (see issue #1 for the evaluation that picked them):
 *
 *   etak        ETAK "vare" ruin footprints (Maa-amet WFS)
 *   osm         OSM ruin/abandoned tags (Overpass)
 *   esap        military-heritage objects (teejuht.esap.ee, good faith)
 *   teadaanded  officially ownerless buildings (Ametlikud Teadaanded)
 *
 * Writes public/data/layers/<id>.json. Independent of `npm run scrape`;
 * run with `npm run scrape-hints`. Reruns are cached under data/cache/.
 * Name sources to rebuild only those: `npm run scrape-hints -- esap osm`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { buildEtakLayer } from './etak.ts'
import { buildOsmLayer } from './osm.ts'
import { buildEsapLayer } from './esap.ts'
import { buildTeadaandedLayer } from './teadaanded.ts'
import type { HintLayerDataset, HintSourceId } from '../../src/types.ts'

const BUILDERS: Record<HintSourceId, () => Promise<HintLayerDataset>> = {
  etak: buildEtakLayer,
  osm: buildOsmLayer,
  esap: buildEsapLayer,
  teadaanded: buildTeadaandedLayer,
}

async function main() {
  const wanted = process.argv.slice(2)
  const unknown = wanted.filter((id) => !(id in BUILDERS))
  if (unknown.length) throw new Error(`Unknown hint source(s): ${unknown.join(', ')}`)
  const ids = (wanted.length ? wanted : Object.keys(BUILDERS)) as HintSourceId[]

  await mkdir('public/data/layers', { recursive: true })
  for (const id of ids) {
    const dataset = await BUILDERS[id]()
    await writeFile(`public/data/layers/${id}.json`, JSON.stringify(dataset))
    console.log(`Wrote public/data/layers/${id}.json: ${dataset.spots.length} spots\n`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
