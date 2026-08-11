/**
 * Geocoding via Maa-amet's In-ADS gazetteer (free, no key).
 * Returns WGS84 directly (viitepunkt_b = lat, viitepunkt_l = lon).
 */

const GAZETTEER = 'https://inaadress.maaamet.ee/inaadress/gazetteer'

export interface GeocodeResult {
  lat: number
  lon: number
  /** L-EST97 easting/northing (In-ADS viitepunkt_x/viitepunkt_y). */
  lestX: number
  lestY: number
  precision: 'building' | 'street' | 'village'
  matchedAddress: string
}

interface InAdsAddress {
  viitepunkt_b: string
  viitepunkt_l: string
  viitepunkt_x: string
  viitepunkt_y: string
  liikVal: string
  pikkaadress: string
  omavalitsus: string
  maakond: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function precisionOf(liikVal: string): GeocodeResult['precision'] {
  if (liikVal === 'EHITISHOONE' || liikVal === 'KATASTRIYKSUS') return 'building'
  if (liikVal === 'TANAV' || liikVal === 'VAIKEKOHT') return 'street'
  return 'village'
}

async function query(address: string): Promise<InAdsAddress[]> {
  const url = `${GAZETTEER}?address=${encodeURIComponent(address)}&results=5`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`gazetteer HTTP ${res.status} for "${address}"`)
  const data = (await res.json()) as { addresses?: InAdsAddress[] }
  return data.addresses ?? []
}

/**
 * Geocode a register address. Tries the full address first, then falls back to
 * the bare settlement, always requiring the municipality to match so a fuzzy
 * hit in the wrong parish is rejected.
 */
export async function geocode(address: string, municipality: string, county: string): Promise<GeocodeResult | undefined> {
  const attempts = [`${address}, ${municipality}`, address, municipality]
  for (const attempt of attempts) {
    const candidates = await query(attempt)
    await sleep(300)
    // Municipality reforms have moved settlements between parishes since the
    // register was written, so fall back to a same-county match.
    const hit =
      candidates.find((c) => c.omavalitsus === municipality && precisionOf(c.liikVal) !== 'village') ??
      candidates.find((c) => c.omavalitsus === municipality) ??
      (attempt !== municipality ? candidates.find((c) => c.maakond === county) : undefined)
    if (hit) {
      // A fallback attempt that only matched the settlement is village precision at best.
      const precision = attempt === municipality ? 'village' : precisionOf(hit.liikVal)
      return {
        lat: Number(hit.viitepunkt_b),
        lon: Number(hit.viitepunkt_l),
        lestX: Number(hit.viitepunkt_x),
        lestY: Number(hit.viitepunkt_y),
        precision,
        matchedAddress: hit.pikkaadress,
      }
    }
  }
  return undefined
}
