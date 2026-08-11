# Bando Map

A full-screen map of abandoned buildings ("bandos") in Estonia — potential FPV drone flying spots.

Data comes from the Estonian heritage register's [XX century architecture catalog](https://register.muinas.ee/public.php?menuID=architecture), filtered to buildings that are **not in use** (kasutus: ei kasutata) and in **poor condition** (seisukord: halb). Each spot links back to the register, Google Maps, and Maa-amet's [XGIS](https://xgis.maaamet.ee/xgis2/page/app/maainfo).

<p align="center">
  <img src="docs/screenshot-desktop.png" alt="Bando Map on desktop — clustered spots across Estonia with the in-view list sidebar" width="800">
</p>
<p align="center">
  <img src="docs/screenshot-mobile.png" alt="Bando Map on mobile — detail sheet with photos, triage buttons and rating" width="260">
</p>

The base map is Maa-amet's own tile service — the same detailed base map, orthophoto, and hybrid layers as the official maainfo app.

## Quick start

```sh
npm install
npm run dev        # app on http://localhost:5173
```

The dataset (`public/data/bandos.json`) is committed, so the app works without running the scraper.

## Refreshing the data

```sh
npm run scrape     # first run ~30–40 min with default polite delays; reruns are cached
```

The pipeline (`scripts/scrape/`):

1. Scrapes the **full catalog** (~1,950 records): one unfiltered search plus one search per usage/condition value to attribute those fields (the register's list view doesn't show them; searches POST to a PHP session, pagination reuses the cookie). Row counts are validated against the register's own "Kokku: N" totals.
2. Marks **candidates** — records that are unused (*ei kasutata*) or in poor condition (*halb*).
3. Geocodes candidates with Maa-amet's free [In-ADS gazetteer](https://inaadress.maaamet.ee/) — no API key. Every point carries a `geocode` precision flag (`building` / `street` / `village`), since some register addresses are only village-level.
4. Applies manual coordinate fixes from `data/overrides.json` (`geocode: "manual"` — wins over everything). Cross-referencing the official monument register was tried and dropped: the two catalogs name buildings too differently for reliable matching.
5. Downloads one photo per candidate and stores a 480px webp in `public/thumbs/` (local thumbnails keep the map fast and are a step toward full offline use).
6. Writes `public/data/bandos.json` (geocoded candidates, used by the app) and `data/catalog.json` (everything).

Everything is disk-cached under `data/cache/` (gitignored) — delete it for a fresh run. `SCRAPE_DELAY_MS` (default 3000) and `IMAGE_DELAY_MS` (default 1500) tune request pacing. Be considerate — it's a small public heritage service.

## Architecture

- **Vite + React + TypeScript**, [MapLibre GL JS](https://maplibre.org/) for the map (WebGL, built-in clustering, smooth on mobile).
- Map tiles: Maa-amet public TMS (`kaart@GMC`, `foto@GMC`, `hybriid@GMC` — EPSG:3857, TMS y-axis).
- All user state lives in the browser's localStorage, exportable/importable as JSON. No backend, no accounts, no tracking.
- **Workflow**: triage spots online — *Shortlist* the promising ones, *Reject* the duds (hidden by default, recoverable via filters) — then mark them *Visited* in the field and rate 1–5 stars with notes. Marker colors: red = new, blue = shortlisted, green = visited, gray = rejected.
- **Custom places**: add your own spots (name + notes, no photos) straight onto the map; they live in localStorage and ride along in exports.
- **Deep links**: selecting a spot puts `#b/<id>@<lat>,<lon>` in the URL — share it, and if the receiver doesn't have that spot, the map zooms to the coordinates instead.
- `src/types.ts` is the single schema shared by the app and the scraper.

## Roadmap

- [x] **Phase 0 — POC**: scrape the ~116 unused/poor-condition buildings, geocode, show clustered on the map with photos and detail panel
- [x] **Phase 1 — Full data pipeline**: all catalog records with usage/condition attribution, local thumbnails, manual coordinate overrides
- [x] **Phase 2 — User state**: triage workflow (shortlist / reject online, then visit, rate and take notes in the field), multi-select filters, note-aware search, JSON export/import, custom places, shareable deep links
- [ ] **Phase 3 — Polish & offline**: photo markers at high zoom, full offline support in the field (PWA: app shell, dataset, thumbnails, and visited-area map tiles cached locally)
- [ ] **Phase 4 — Ideas**: accounts with SSO for cross-device sync, auto-graded attributes (remote vs urban), periodic scraping

## Deployment

The app is a static site served from S3 behind CloudFront at **https://bando.toom.as**.

- `infra/` holds the Terraform/OpenTofu stack: private S3 origin (OAC), CloudFront with SPA fallback, ACM certificate, Route53 records, and a GitHub-OIDC deploy role — no long-lived AWS keys anywhere. Apply locally: `cd infra && terraform apply` (uses ambient AWS credentials, or pass `-var aws_profile=...`). State is local and gitignored.
- `.github/workflows/deploy.yml` builds and syncs `dist/` to S3 on every push to `main` (hashed assets get immutable caching; the HTML shell and dataset revalidate), then invalidates CloudFront. It authenticates by assuming the OIDC role from repo variables `AWS_DEPLOY_ROLE_ARN`, `S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`.

## Attribution

- Building data: [Kultuurimälestiste register](https://register.muinas.ee/) (Muinsuskaitseamet), reused under Estonia's public information act
- Base map, orthophoto, geocoding: [Maa-amet](https://geoportaal.maaamet.ee/)

Fly responsibly: heritage-listed buildings are protected — look, film, don't touch. Check local drone regulations (droonid.ee) before flying.
