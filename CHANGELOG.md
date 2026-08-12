# Changelog

All notable changes to Bando Map. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/) — minor = feature release, patch = fix.

Versions up to and including v0.13.0 were tagged retroactively from git
history — the dates are the real commit dates.

## [1.2.0] — 2026-08-12

- **Drone airspace on the map.** Estonia's official UAS geographical zones — the
  ones behind the national drone map at https://utm.eans.ee/avm/ — draw as their
  own layer, coloured by how much each zone actually restricts flight. Every
  zone carries its vertical band, so the layer answers "how high can I legally
  go here" rather than "am I inside a zone": a countrywide 150–2900 m band
  covers literally every spot on the map, which makes a bare in-a-zone flag
  useless. The layer always shows how old its copy is and links the official
  map as the authority — it is a triage aid for picking spots from the sofa,
  never an authoritative preflight source. Check https://utm.eans.ee/avm/ and
  NOTAMs before you fly.

- The copy is refreshed hourly by a scheduled Lambda instead of being fetched by
  your browser. The source is uncompressed — 5.1 MB whatever encoding you ask
  for — and served `Cache-Control: private, max-age=1`, so no CDN or browser
  cache helps, and requesting a smaller area barely does either (a box with 15
  zones in it still returns 2.1 MB, because a few enormous national rings are in
  every response). Fetching it per visitor would also send every visitor's IP to
  EANS and leave the layer blank offline. The Lambda trims the file to 1.11 MB
  (about 289 kB over the CDN) by dropping a duplicated copy of each zone's
  geometry and rounding coordinates to 6 decimals.

- A **Refresh** button for when the hourly copy is too old to trust, throttled to
  3 refreshes per client per day and 10 overall per hour. The per-client counter
  is keyed by a salted hash of the address that expires on its own, so no raw IP
  is stored anywhere — the same stance as the rest of the app.

- Needs the backend deployed (`terraform -chdir=infra apply`); the zones layer is
  not part of the site workflow.

- **Map controls moved out of the panel.** The Map / Aerial / Hybrid choice now
  sits on the map itself, left of the zoom buttons, so it stays reachable with
  the panel collapsed or the mobile sheet shut. A **Layers** button under "show
  my location" opens a menu holding everything drawn on the map — the four hint
  sources and the airspace zones, each with its own checkbox — plus the airspace
  height cut, legend, copy age and Refresh. The button only opens and closes the
  menu; the checkboxes decide what is drawn. Filters is now purely about which
  spots you see.

- The airspace copy turns **red with a nudge to refresh once no check has
  succeeded for over 6 hours** — the fetcher runs hourly, so that already means
  it has been failing.

- Scrolling with the pointer over a number field no longer silently edits it
  instead of scrolling the page — easy to trigger by accident on a trackpad.
  The spinner arrows are gone with it, since they misfire the same way.

- Map popups close from a button inset properly in the corner rather than
  jammed against the edge.

## [1.1.1] — 2026-08-12

- Approved contributions now land on the **next** page load rather than the one
  after it. `data/community.json` carries decisions, but the service worker
  served it stale-while-revalidate like the rest of the dataset: the first load
  after an approval used the copy from before it, and only the second saw the
  change. It is fetched network-first now, still falling back to the cache when
  offline. This affected every approval; an approved deletion made it obvious,
  because the place stayed on the map.

- A place whose deletion has gone live no longer keeps its *deletion proposed*
  pill. The local mark that was waiting for the decision is cleared when the
  decision arrives.

- Delete now appears only while Edit is open, instead of sitting in the top bar
  of every place. Withdrawing a queued deletion lives in the same place — open
  Edit and the button reads *Undo delete*.

- *Your submissions* rows show what each one asked for: a pin for a place you
  added, a pencil for a correction, a trash can for a deletion, each with a
  title on hover. A name and a status could not tell them apart before.

## [1.1.0] — 2026-08-12

- **Delete a place.** The detail panel's top bar has a red Delete button next to
  Edit and Move. Deleting your own place — one you added and haven't contributed
  yet — is immediate and local, as before. Everything else on the shared map
  (register records, community spots, places of yours that were approved) goes
  through review instead: pick a reason, and the deletion queues in Contribute
  alongside your pin moves and corrections. The pin stays on your map, tagged
  *deletion proposed*, until an admin decides; Undo delete withdraws it any time
  before that. Approved deletions land in `data/community.json` and drop the
  place everywhere — map, list, search and counts alike. Needs the backend
  deployed (`terraform -chdir=infra apply`) for the new submission type.

## [1.0.1] — 2026-08-12

- Raw CloudFront access logs now expire after seven years instead of being kept
  forever. Those records are the only place a visitor's IP address is ever
  written down, so an open-ended archive meant an open-ended retention of them;
  seven years bounds it. The daily aggregates the Visits card actually reads
  have never held an address and still have no expiry, so nothing is lost from
  the visit history — only the raw records behind it age out. Set
  `stats_log_retention_days` to `null` to keep them indefinitely again.

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
