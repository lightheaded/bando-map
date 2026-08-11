/**
 * WGS84 → L-EST97 (EPSG:3301) forward projection: Lambert Conformal Conic
 * with two standard parallels on the GRS80 ellipsoid. Lets the app produce
 * xgis.maaamet.ee links for moved pins and custom places, whose dataset
 * L-EST97 coordinates are absent or stale.
 *
 * Matches the proj4 definition used by the scraper
 * (+proj=lcc +lat_1=59.33333333333334 +lat_2=58 +lat_0=57.51755393055556
 *  +lon_0=24 +x_0=500000 +y_0=6375000 +ellps=GRS80).
 */

const DEG = Math.PI / 180
const A = 6378137
const F = 1 / 298.257222101
const E = Math.sqrt(F * (2 - F))

const LAT1 = 59.33333333333334 * DEG
const LAT2 = 58 * DEG
const LAT0 = 57.51755393055556 * DEG
const LON0 = 24 * DEG
const FALSE_EASTING = 500000
const FALSE_NORTHING = 6375000

const m = (lat: number) => Math.cos(lat) / Math.sqrt(1 - E * E * Math.sin(lat) ** 2)
const t = (lat: number) =>
  Math.tan(Math.PI / 4 - lat / 2) / ((1 - E * Math.sin(lat)) / (1 + E * Math.sin(lat))) ** (E / 2)

const N = (Math.log(m(LAT1)) - Math.log(m(LAT2))) / (Math.log(t(LAT1)) - Math.log(t(LAT2)))
const BIG_F = m(LAT1) / (N * t(LAT1) ** N)
const RHO0 = A * BIG_F * t(LAT0) ** N

/** Returns { x: easting, y: northing } — the same convention as Bando.lestX/lestY. */
export function wgs84ToLest97(lat: number, lon: number): { x: number; y: number } {
  const rho = A * BIG_F * t(lat * DEG) ** N
  const theta = N * (lon * DEG - LON0)
  return {
    x: Math.round(FALSE_EASTING + rho * Math.sin(theta)),
    y: Math.round(FALSE_NORTHING + RHO0 - rho * Math.cos(theta)),
  }
}
