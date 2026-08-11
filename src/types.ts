/** One abandoned/derelict building from the muinas.ee XX-century architecture catalog. */
export interface Bando {
  /** Register id (`public.php?menuID=architecture&action=view&id=<id>`). */
  id: number
  name: string
  county: string
  municipality: string
  address: string
  /** Dating period: tsaariaeg | vabariik | nõukogude. */
  period?: string
  usage?: string
  condition?: string
  /** WGS84. */
  lat: number
  lon: number
  /** L-EST97 (EPSG:3301) easting/northing, for xgis.maaamet.ee links. */
  lestX?: number
  lestY?: number
  /**
   * How the coordinate was obtained — building/manual are exact,
   * street and village are approximate centroids.
   */
  geocode: 'building' | 'street' | 'village' | 'manual'
  /** Photo ids under register.muinas.ee/content/architecture/regular/<photoId>.jpg */
  photos: number[]
  /** Local thumbnail path relative to the app base, e.g. "thumbs/45.webp". */
  thumb?: string
}

export interface BandoDataset {
  version: 1
  scrapedAt: string
  source: string
  bandos: Bando[]
}

/** Per-bando user state, localStorage-only for now. Versioned for a future backend. */
export interface UserMark {
  visited?: boolean
  hidden?: boolean
  rating?: 1 | 2 | 3 | 4 | 5
  comment?: string
  updatedAt: string
}

export interface UserData {
  version: 1
  marks: Record<number, UserMark>
}

export const USAGE_VALUES = ['ei kasutata', 'elumaja', 'kasutusel', 'koolimaja', 'sakraalhoone', 'tuletorn'] as const
export const CONDITION_VALUES = ['halb', 'rahuldav', 'hea'] as const

export const MUINAS_DETAIL_URL = (id: number) =>
  `https://register.muinas.ee/public.php?menuID=architecture&action=view&id=${id}`

export const PHOTO_URL = (photoId: number) =>
  `https://register.muinas.ee/content/architecture/regular/${photoId}.jpg`

export const GMAPS_URL = (lat: number, lon: number) => `https://www.google.com/maps?q=${lat},${lon}`

export const GMAPS_DIRECTIONS_URL = (lat: number, lon: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`

export const XGIS_URL = (lestX: number, lestY: number) =>
  `https://xgis.maaamet.ee/xgis2/page/app/maainfo?punkt=${lestX},${lestY}&moot=2000`
