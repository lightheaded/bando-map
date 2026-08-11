# Bando Map

A full-screen map of abandoned buildings ("bandos") in Estonia — potential FPV drone flying spots.

Data comes from the Estonian heritage register's [XX century architecture catalog](https://register.muinas.ee/public.php?menuID=architecture), filtered to buildings that are **not in use** (kasutus: ei kasutata) and in **poor condition** (seisukord: halb). Each spot links back to the register, Google Maps, and Maa-amet's [XGIS](https://xgis.maaamet.ee/xgis2/page/app/maainfo).

The base map is Maa-amet's own tile service — the same detailed base map, orthophoto, and hybrid layers as the official maainfo app.

## Quick start

```sh
npm install
npm run dev        # app on http://localhost:5173
```

The dataset (`public/data/bandos.json`) is committed, so the app works without running the scraper.

## Refreshing the data

```sh
npm run scrape     # ~3 min with default polite delays
```

The scraper:

1. POSTs the search filter (`usage=768` "ei kasutata", `condition=766` "halb") to `register.muinas.ee` and walks the paginated results using the PHP session cookie. Row counts are validated against the register's own "Kokku: N" total.
2. Geocodes each record's address with Maa-amet's free [In-ADS gazetteer](https://inaadress.maaamet.ee/) — no API key needed. Every point carries a `geocode` precision flag (`building` / `street` / `village`), since some register addresses are only village-level.
3. Writes `public/data/bandos.json` (WGS84 + L-EST97 coordinates, photo ids, condition/usage).

`SCRAPE_DELAY_MS` (default 3000) tunes the delay between register requests. Be considerate — it's a small public heritage service.

## Architecture

- **Vite + React + TypeScript**, [MapLibre GL JS](https://maplibre.org/) for the map (WebGL, built-in clustering, smooth on mobile).
- Map tiles: Maa-amet public TMS (`kaart@GMC`, `foto@GMC`, `hybriid@GMC` — EPSG:3857, TMS y-axis).
- All user state (visited / hidden / ratings / comments — coming in Phase 2) lives in the browser's localStorage and will be exportable as JSON. No backend, no accounts, no tracking.
- `src/types.ts` is the single schema shared by the app and the scraper.

## Roadmap

- [x] **Phase 0 — POC**: scrape the ~116 unused/poor-condition buildings, geocode, show clustered on the map with photos and detail panel
- [ ] **Phase 1 — Full data pipeline**: all ~1,944 catalog records with usage/condition attribution, coordinate cross-referencing against the official monument register, local thumbnails, manual coordinate overrides
- [ ] **Phase 2 — User state**: visited / hide / 1–5 stars / comment, filters, JSON export/import
- [ ] **Phase 3 — Polish**: photo markers at high zoom, better mobile bottom sheet, offline support
- [ ] **Phase 4 — Ideas**: accounts with SSO for cross-device sync, auto-graded attributes (remote vs urban), periodic scraping

## Attribution

- Building data: [Kultuurimälestiste register](https://register.muinas.ee/) (Muinsuskaitseamet), reused under Estonia's public information act
- Base map, orthophoto, geocoding: [Maa-amet](https://geoportaal.maaamet.ee/)

Fly responsibly: heritage-listed buildings are protected — look, film, don't touch. Check local drone regulations (droonid.ee) before flying.
