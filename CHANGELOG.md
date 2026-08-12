# Changelog

All notable changes to Bando Map. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/) — minor = feature release, patch = fix.

Versions up to and including v0.13.0 were tagged retroactively from git
history — the dates are the real commit dates.

## [1.0.0] — 2026-08-12

First stable release. Everything on the original roadmap has shipped: the full
register scraped and mapped, the triage-and-visit workflow, offline use in the
field, cross-device sync, and community corrections that go live for everyone
without a rescrape. The version number is the only thing that changes for
existing users — nothing here needs a migration, and signed-out use still keeps
localStorage as the source of truth.

- Admin panel: a **Visits** card with daily page views, distinct visitors and a
  per-day country breakdown, plus a separate crawler count so bot spikes can be
  told apart from real traffic. The numbers come from CloudFront's own access
  logs (no analytics script, no cookie, no third party): standard logging v2
  delivers eight fields to a private bucket and a scheduled Lambda folds each
  day into one DynamoDB item. The raw log archive is kept indefinitely so later
  questions can still be answered against the original records. Marginal cost
  is a couple of cents a month — see the README Cost table.

- Admin rights now come from membership of an `admin` Cognito group instead of
  an email allowlist that had to be written into Terraform and mirrored into
  the frontend bundle. No personal address ships in the app or lives in this
  repository any more, and granting or revoking admin no longer needs a deploy
  — see the README "Granting admin".

- Military-heritage (ESAP) hints now open their own database record
  (`db.esap.ee/object/<id>`) instead of the generic object list, preview up
  to six photos from that record, and carry the database's object name. The
  photo strip scrolls sideways with the mouse wheel without zooming the map.
- Hint popups name the record each link opens ("ESAP record", "OSM object",
  "Official notice") and no longer repeat a generic source link beside it.
- `npm run scrape-hints` accepts source names, so one layer can be rebuilt
  on its own: `npm run scrape-hints -- esap`.
- Coordinate pass: records with an archived register PDF now use every
  location signal in it — printed coordinates (all the layout variants,
  including degrees-minutes-seconds), the cadastral number resolved through
  In-ADS, and the PDF's street-level address — instead of geocoding the
  often village-only catalog address. 30 pins moved to better positions,
  several by kilometers (three Saaremaa records were 20–60 km off).
- Triage toggles are color-coded checkboxes now — blue Shortlisted, red
  Rejected, green Visited; outlined when off, softly filled when on.
- Mobile: tapping a cluster now centers the dots in the map area above the
  open sheet, instead of hiding them behind it.
- Show the app version behind the map attribution (i) icon, linking to this
  changelog; versioning and release process (this file, git tags, GitHub
  Releases auto-created from pushed tags).
- New-version notice is a dismissable banner at the top of the screen
  (replaces the easy-to-miss sidebar button); says the update reloads the
  app and keeps your data, and comes back an hour after being closed.

## [0.13.0] — 2026-08-12

- Community sourcing: anyone can submit corrections and new places for
  review; an admin approves or rejects them directly on the map.
- Contribute panel: jump to a submitted change on the map.
- Five bottom tabs (icon-over-label, corner badges) so all panels fit on
  mobile.
- Detail card: clearer triage toggles, tools grouped, less clutter.
- Desktop: collapsible sidebar for full-map exploring.

## [0.12.0] — 2026-08-11

- Offline panel split into Downloads, Storage and Sync tabs.
- New app versions show an Update notification instead of force-reloading
  mid-session.
- Licensed under MIT; scraped register content is no longer redistributed
  through the repo.

## [0.11.0] — 2026-08-11

- Cross-device sync: sign in and your marks follow you between devices
  (Cognito + HTTP API + Lambda + DynamoDB, private per-user storage).

## [0.10.0] — 2026-08-11

- Offline PWA: installable app, save map areas for offline use, transparent
  storage accounting with clear labeling and upfront download sizes.

## [0.9.0] — 2026-08-11

- Photo markers for unclustered spots, shown by marker density rather than a
  fixed zoom threshold.

## [0.8.0] — 2026-08-11

- Correction tools: Move and Edit with undo, for fixing pin positions and
  place details.
- North-up map (rotation disabled), swipe gesture on the mobile sheet.
- Geocoder fix for the address reform.

## [0.7.0] — 2026-08-11

- Coordinates extracted from register PDFs (much better pin accuracy), links
  to the PDF archive, chip icons.
- CloudFront cost guard.
- Moved to https://bando.lagle.xyz.

## [0.6.0] — 2026-08-11

- Visit date tracking.
- First public deployment: S3 + CloudFront, deployed from GitHub Actions on
  every push to main.

## [0.5.0] — 2026-08-11

- Single-sidebar UI with an in-view places list; the map view persists
  across sessions.

## [0.4.0] — 2026-08-11

- Triage workflow, multiselect filters, English UI, custom places, and deep
  links to places.

## [0.3.0] — 2026-08-11

- Full data pipeline: 324 candidate places scraped from the heritage
  register, with local thumbnails.

## [0.2.0] — 2026-08-11

- User marks, filters, export/import of your data.
- UX pass: panel docking, selection centering, interaction states.

## [0.1.0] — 2026-08-11

- Proof of concept: map of abandoned buildings in Estonia for FPV flying,
  on Maa-amet base layers.
