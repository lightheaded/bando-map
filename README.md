# Bando Map

**Live at [bando.lagle.xyz](https://bando.lagle.xyz)** — every push to `main` deploys automatically.

A full-screen map of abandoned buildings ("bandos") in Estonia — potential FPV drone flying spots.

Data comes from the Estonian heritage register's [XX century architecture catalog](https://register.muinas.ee/public.php?menuID=architecture), filtered to buildings that are **not in use** (kasutus: ei kasutata) and in **poor condition** (seisukord: halb). Each spot links back to the register, Google Maps, and Maa-amet's [XGIS](https://xgis.maaamet.ee/xgis2/page/app/maainfo).

<p align="center">
  <img src="docs/screenshot-desktop.png" alt="Bando Map on desktop — clustered spots across Estonia with the in-view list sidebar" width="672">
  <img src="docs/screenshot-mobile.png" alt="Bando Map on mobile — detail sheet with photos, triage buttons and rating" width="194">
</p>

The base map is Maa-amet's own tile service — the same detailed base map, orthophoto, and hybrid layers as the official maainfo app.

## Quick start

```sh
npm install
npm run dev        # app on http://localhost:5173
```

The scraped dataset and thumbnails are **not in git** (the register's content isn't ours to redistribute) — they live only in S3 and the scraper reproduces them. For a working dev setup, pull the live dataset:

```sh
mkdir -p public/data
curl -so public/data/bandos.json https://bando.lagle.xyz/data/bandos.json
```

Photos will 404 locally without `public/thumbs/` — run the scraper (below) or sync them from the bucket (`aws s3 sync s3://bando.lagle.xyz/thumbs public/thumbs`, needs credentials) if you want them.

## Refreshing the data

```sh
npm run scrape        # first run ~30–40 min with default polite delays; reruns are cached
npm run publish-data  # sync public/data + public/thumbs to S3, invalidate /data/*
```

The pipeline (`scripts/scrape/`):

1. Scrapes the **full catalog** (~1,950 records): one unfiltered search plus one search per usage/condition value to attribute those fields (the register's list view doesn't show them; searches POST to a PHP session, pagination reuses the cookie). Row counts are validated against the register's own "Kokku: N" totals.
2. Marks **candidates** — records that are unused (*ei kasutata*) or in poor condition (*halb*).
3. Geocodes candidates with Maa-amet's free [In-ADS gazetteer](https://inaadress.maaamet.ee/) — no API key. Register addresses predate the administrative reforms, so queries retry with settlement-type words stripped (e.g. *Ilmatsalu alevik* is now a *küla* — the stale type word makes In-ADS return nothing). Every point carries a `geocode` precision flag (`building` / `street` / `village`), since some register addresses are only village-level.
4. Applies manual corrections from `data/overrides.json` — coordinates from the app's Move tool (`geocode: "manual"`) and register-field edits from the Edit tool; wins over everything. Cross-referencing the official monument register was tried and dropped: the two catalogs name buildings too differently for reliable matching.
5. Downloads one photo per candidate and stores a 480px webp in `public/thumbs/` (local thumbnails keep the map fast and are a step toward full offline use).
6. Writes `public/data/bandos.json` (geocoded candidates, used by the app) and `data/catalog.json` (everything). Both are gitignored — `npm run publish-data` ships them to S3, which is their only home.

Everything is disk-cached under `data/cache/` (gitignored) — delete it for a fresh run. `SCRAPE_DELAY_MS` (default 3000) and `IMAGE_DELAY_MS` (default 1500) tune request pacing. Be considerate — it's a small public heritage service.

## Architecture

- **Vite + React + TypeScript**, [MapLibre GL JS](https://maplibre.org/) for the map (WebGL, built-in clustering, smooth on mobile).
- Map tiles: Maa-amet public TMS (`kaart@GMC`, `foto@GMC`, `hybriid@GMC` — EPSG:3857, TMS y-axis).
- All user state lives in the browser's localStorage, exportable/importable as JSON. No backend, no accounts, no tracking.
- **Workflow**: triage spots online — *Shortlist* the promising ones, *Reject* the duds (hidden by default, recoverable via filters) — then mark them *Visited* in the field and rate 1–5 stars with notes. Marker colors: red = new, blue = shortlisted, green = visited, gray = rejected.
- **Custom places**: add your own spots (name + notes, no photos) straight onto the map; they live in localStorage and ride along in exports.
- **Corrections**: the *Move* tool repositions a wrong pin (with undo), the *Edit* tool corrects register fields (name, address, era, usage, condition). Corrections are stored as their own keys in the export, and *Copy fixes* in the filter panel emits them as ready-to-paste `data/overrides.json` content, so they flow back into the shared dataset on the next scrape.
- **Deep links**: selecting a spot puts `#b/<id>@<lat>,<lon>` in the URL — share it, and if the receiver doesn't have that spot, the map zooms to the coordinates instead.
- **Offline (PWA)**: installable; everything browsed (app, dataset, photos, map tiles) is cached automatically and keeps working without signal. The Offline panel is transparent about storage — real byte counts per category, clearable — and lets you save the current map view down to street level, or all spot photos, before heading somewhere remote. Maa-amet serves CORS-clean tiles, so cached sizes are honest (no opaque-response padding).
- **Cross-device sync (optional)**: sign in from the Offline panel and your marks, notes, custom places and corrections follow you to every device. Merging is per-mark by `updatedAt` (the same logic as JSON import), so devices don't clobber each other. Signed-out use is unaffected — localStorage remains the source of truth.
- `src/types.ts` is the single schema shared by the app and the scraper.

## Roadmap

Work is tracked on the [Bando Map project board](https://github.com/users/lightheaded/projects/2).

- [x] **Phase 0 — POC**: scrape the ~116 unused/poor-condition buildings, geocode, show clustered on the map with photos and detail panel
- [x] **Phase 1 — Full data pipeline**: all catalog records with usage/condition attribution, local thumbnails, manual coordinate overrides
- [x] **Phase 2 — User state**: triage workflow (shortlist / reject online, then visit, rate and take notes in the field), multi-select filters, note-aware search, JSON export/import, custom places, shareable deep links
- [x] **Phase 3 — Polish & offline**: photo markers for unclustered spots, installable PWA with full offline support (app shell, dataset, photos, and saved map areas cached locally with a transparent storage panel)
- [ ] **Phase 4 — Ideas**: accounts with SSO for cross-device sync, auto-graded attributes (remote vs urban), periodic scraping

## Sync backend

`infra/backend.tf` + `backend/handler.mjs`: Cognito user pool (Lite, hosted UI, email+password — Google federation can be added later) → API Gateway HTTP API with a JWT authorizer (unauthenticated requests never reach compute) → a single Lambda (arm64, Node 22, no build step) → DynamoDB on-demand, one document per user at `api.bando.lagle.xyz`. Deploys via `terraform -chdir=infra apply` (the handler zip is content-hashed). The SPA config (API URL, Cognito domain, client id — all public identifiers) lives in `src/sync/config.ts`.

Everything scales to zero. Monthly cost at ~5 daily active users (~3k requests):

| Component | Idle | 5 DAU | Notes |
|---|---|---|---|
| API Gateway (HTTP API) | $0 | ~$0.003 | $1.11/M requests |
| Lambda (arm64, 256 MB) | $0 | $0 | inside the permanent free tier (1M req + 400k GB-s) |
| DynamoDB (on-demand) | $0 | ~$0.07 | writes dominate (~25 KB doc = 25 WRU); storage ≪ 25 GB free |
| Cognito (Lite) | $0 | $0 | free to 10,000 MAU |
| CloudWatch logs (14 d) | $0 | <$0.01 | |
| **Total** | **$0.00** | **≈ $0.08** | ~$1.60 even at 100 DAU |

## Deployment

The app is a static site served from S3 behind CloudFront at **https://bando.lagle.xyz**.

- `infra/` holds the Terraform/OpenTofu stack: private S3 origin (OAC), CloudFront with SPA fallback, ACM certificate, Route53 records, and a GitHub-OIDC deploy role — no long-lived AWS keys anywhere. Apply locally: `cd infra && terraform apply` (uses ambient AWS credentials, or pass `-var aws_profile=...`). State is local and gitignored.
- `.github/workflows/deploy.yml` builds and syncs `dist/` to S3 on every push to `main` (hashed assets get immutable caching; the HTML shell revalidates), then invalidates CloudFront. It authenticates by assuming the OIDC role from repo variables `AWS_DEPLOY_ROLE_ARN`, `S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`. The dataset, thumbnails and PDF archive under `/data/`, `/thumbs/` and `/pdfs/` are published out-of-band (`npm run publish-data`) and deploys never touch them.

## Attribution & license

- Building data: [Kultuurimälestiste register](https://register.muinas.ee/) (Muinsuskaitseamet), reused under Estonia's public information act
- Base map, orthophoto, geocoding: [Maa-amet](https://geoportaal.maaamet.ee/)

The source code is [MIT-licensed](LICENSE). Register data and photos are not part of this repository and remain with their respective owners.

Fly responsibly: heritage-listed buildings are protected — look, film, don't touch. Check local drone regulations (droonid.ee) before flying.
