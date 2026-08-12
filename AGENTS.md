# Agent instructions — bando-map

## Track all work on the GitHub Project

Planned, in-progress, and shipped work lives on the **Bando Map project board**:
https://github.com/users/lightheaded/projects/2 (project number 2, owner `lightheaded`,
public since 2026-08-12).

**Every card is backed by a real issue in `lightheaded/bando-map` — never a bare draft
card.** A board doesn't show up in the repository's own Projects tab and is private until
someone publishes it, so a draft card is invisible to anyone who arrives at the repo: it
can't be linked from a commit message, closed by a PR, or read without access to the
board itself. The issue is the durable public record; the card is only its position in
the workflow. Open the issue first and add it to the board — don't create a card and
plan to write the issue later.

**Keep the board current on your own initiative.** Moving a card is part of doing the
work, not something to ask the user about:

- Starting on something → move its card to *In Progress* **before the first edit**. If
  there's no card, open the issue, add it, and set it to *In Progress*.
- Shipped to `main` → card to *Done* and close the issue (`--reason completed`). If what
  shipped is narrower than what the issue described, say so in a closing comment and name
  what was left out.
- New idea from the user → an issue in *Todo*, one per shippable feature, titled
  imperatively ("Add offline tile cache"), body describing intent and any constraints
  discussed.

Issue and card bodies are world-readable. Keep personal identifiers, private hostnames,
internal paths from other repos, and anything credential-shaped out of them — see the
secret rules below.

The board is fully scriptable (this is the expected interface for agents):

```sh
gh project item-list 2 --owner lightheaded --format json      # read the board
gh issue create --repo lightheaded/bando-map \
  --title "Add offline tile cache" --body "…"                 # the issue comes first…
gh project item-add 2 --owner lightheaded --url <ISSUE_URL>   # …then its card
gh project item-edit --id <ITEM_ID> \
  --project-id PVT_kwHOADQXbs4BgDWa \
  --field-id PVTSSF_lAHOADQXbs4BgDWazhaRyQ0 \
  --single-select-option-id <OPTION_ID>                       # move a card
```

Status option ids: Todo `f75ad846`, In Progress `47fc9ee4`, Done `98236657`.
(Re-derive with `gh project field-list 2 --owner lightheaded --format json` if they change.)
The token needs the `project` scope (`gh auth refresh -s project,read:project`).

Should a draft card turn up anyway, convert it in place — this keeps its status, position
and body, and creates the issue from them:

```sh
gh api graphql -f query='mutation($itemId:ID!,$repoId:ID!){
  convertProjectV2DraftIssueItemToIssue(input:{itemId:$itemId,repositoryId:$repoId}){
    item{content{... on Issue{number url}}}}}' \
  -f itemId=<PVTI_…> -f repoId=R_kgDOT1QH2g   # repoId = lightheaded/bando-map
```

Check the body for private details **before** converting: a draft card is only as private
as the board, an issue never is.

## Project conventions

- GitHub account: **`lightheaded`** — always, for this repo (`gh auth switch -u lightheaded`
  if another account is active). Git identity:
  `Tom Välja <3413870+lightheaded@users.noreply.github.com>`, GPG-signed commits
  (key `C41391CFF4DDCC5E`). Remote via the `github-personal` SSH host alias.
- **Every commit must be GPG-signed; never push unsigned commits.** `commit.gpgsign` is
  on and the global pre-push hook (`~/.git-hooks/pre-push`) blocks unsigned pushes — never
  bypass it with `--no-verify`. Verify with `git log --format='%h %G? %s' origin/main..HEAD`:
  every line must show `G` (plumbing like `git commit-tree` skips `commit.gpgsign` — pass `-S`). If an unsigned commit sneaks in, re-sign/rewrite before pushing. The full
  history was re-signed and force-pushed on 2026-08-12 after 23 unsigned commits slipped
  through; commit SHAs from before that date are stale.
- Every push to `main` deploys to https://bando.lagle.xyz (S3+CloudFront, GitHub OIDC —
  see `infra/main.tf` and `.github/workflows/deploy.yml`). Don't push half-done work.
- The sync backend (`backend/handler.mjs`, `infra/backend.tf` — Cognito + HTTP API +
  Lambda + DynamoDB at api.bando.lagle.xyz) deploys via `terraform -chdir=infra apply`,
  NOT via the GitHub workflow. It needs locally available AWS credentials — how they
  are obtained is deliberately not documented here; credentials never live in the repo
  or CI. The SPA-side ids live in `src/sync/config.ts`. Keep it $0 idle:
  on-demand/per-request services only, no provisioned capacity.
- **Cost projections are a living document.** The README "Cost" section holds per-component
  projections plus a running month-by-month Projected/Actual table. Any change that touches
  infra or usage patterns (new AWS resource, new API route, caching behavior, expected
  traffic) must update the projections in the same commit. Actuals come from Cost Explorer
  (`Project=bando-map`, split by `Component`) after a month closes — the user fills them in;
  leave the Actual cell empty, never estimate it.
- The dataset is built by `npm run scrape` and shipped with `npm run publish-data`
  (see README). Be polite to register.muinas.ee: keep the default delays, never run the
  pipeline while `npm run dev` is serving (writes into `public/` make Vite full-reload
  continuously).
- Never commit scraped register content — `public/data/`, `public/thumbs/`,
  `data/catalog.json`, `data/pdfs/` (338MB archive) — it isn't ours to redistribute;
  S3 is its only home (`npm run publish-data`, pdfs out-of-band) and the scraper
  reproduces it. It was purged from git history on 2026-08-11; don't reintroduce it.
  Also never commit terraform state or anything personal. gitleaks runs on every commit.
- **Every feature that ships to `main` is a release.** Keep `CHANGELOG.md` current: note
  user-visible changes under `[Unreleased]` as you work; when shipping, move them under a
  new version heading, bump `version` in `package.json` to match (minor for features,
  patch for fixes), and tag: `git tag -a v0.X.0 -m "summary"`, `git push --follow-tags`.
  The tag push auto-creates a GitHub Release from the changelog section (release.yml).
  The app shows this version behind the map attribution ⓘ (injected from package.json in
  `vite.config.ts`).
- `src/types.ts` is the single schema shared by app and scraper; keep it that way.
- Verify UI changes in a real browser before committing — the Chrome extension is
  enough, no Playwright needed. `window.__map` and `window.__store` are exposed in
  all builds, so drive app state directly rather than clicking through the app.
  Cover phone and desktop-dock widths: the harness can't resize the viewport or
  open the mobile sheet (it drags via touch handlers that ignore synthetic
  clicks), so force the container instead — set `style.cssText` on `.sidebar` and
  check 320 / 360 / 420 px. Say in the report which parts you couldn't exercise.
