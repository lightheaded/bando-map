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
   * How the coordinate was obtained — register (from the record's PDF),
   * building and manual are exact; street and village are approximate centroids.
   */
  geocode: 'register' | 'building' | 'street' | 'village' | 'manual'
  /** Photo ids under register.muinas.ee/content/architecture/regular/<photoId>.jpg */
  photos: number[]
  /** True for user-added places (kept in localStorage, not in the dataset). */
  custom?: boolean
  /**
   * Local thumbnail paths aligned with `photos` (null where the download
   * failed), relative to the app base, e.g. "thumbs/45.webp".
   */
  thumbs?: (string | null)[]
}

export interface BandoDataset {
  version: 1
  scrapedAt: string
  source: string
  bandos: Bando[]
}

/**
 * Per-bando user state, localStorage-only for now. Versioned for a future backend.
 *
 * Two independent axes: `status` is the online-triage verdict (undefined = new,
 * not yet triaged), `visited` records that you were physically there — so
 * "visited but rejected" and "visited, 5 stars" are both expressible.
 */
export interface UserMark {
  status?: 'shortlisted' | 'rejected'
  visited?: boolean
  /** Date of the (latest) visit, YYYY-MM-DD. Set to today when visited is toggled on. */
  visitedAt?: string
  rating?: 1 | 2 | 3 | 4 | 5
  comment?: string
  updatedAt: string
}

export type TriageStatus = 'new' | 'shortlisted' | 'rejected'

/** A user-added spot not in any register. Negative ids so they never collide. */
export interface CustomPlace {
  id: number
  name: string
  lat: number
  lon: number
  createdAt: string
}

export interface UserData {
  version: 1
  marks: Record<number, UserMark>
  customPlaces?: CustomPlace[]
}

export const USAGE_VALUES = ['ei kasutata', 'elumaja', 'kasutusel', 'koolimaja', 'sakraalhoone', 'tuletorn'] as const
export const CONDITION_VALUES = ['halb', 'rahuldav', 'hea'] as const

/** The register data stays in Estonian; the UI displays English. */
export const EN: Record<string, string> = {
  'ei kasutata': 'not in use',
  elumaja: 'residential',
  kasutusel: 'in use',
  koolimaja: 'schoolhouse',
  sakraalhoone: 'sacral building',
  tuletorn: 'lighthouse',
  halb: 'poor',
  rahuldav: 'fair',
  hea: 'good',
  tsaariaeg: 'Tsarist era',
  vabariik: 'first republic',
  nõukogude: 'Soviet era',
}
export const en = (value: string | undefined) => (value ? (EN[value] ?? value) : undefined)

/** Small icons for the attribute pills. */
export const ICON: Record<string, string> = {
  'ei kasutata': '🚫',
  elumaja: '🏠',
  kasutusel: '👥',
  koolimaja: '🎓',
  sakraalhoone: '⛪',
  tuletorn: '🗼',
  halb: '🧱',
  rahuldav: '🔧',
  hea: '✨',
  tsaariaeg: '👑',
  vabariik: '🏛️',
  nõukogude: '🚩',
}

/** Archived register PDFs, served from the app's own CDN. */
export const PDF_URL = (id: number) => `https://bando.toom.as/pdfs/${id}.pdf`

export const MUINAS_DETAIL_URL = (id: number) =>
  `https://register.muinas.ee/public.php?menuID=architecture&action=view&id=${id}`

export const PHOTO_URL = (photoId: number) =>
  `https://register.muinas.ee/content/architecture/regular/${photoId}.jpg`

export const GMAPS_URL = (lat: number, lon: number) => `https://www.google.com/maps?q=${lat},${lon}`

export const GMAPS_DIRECTIONS_URL = (lat: number, lon: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`

export const XGIS_URL = (lestX: number, lestY: number) =>
  `https://xgis.maaamet.ee/xgis2/page/app/maainfo?punkt=${lestX},${lestY}&moot=2000`
