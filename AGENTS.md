# Agent instructions — bando-map

## Track all work on the GitHub Project

Planned, in-progress, and shipped work lives on the **Bando Map project board**:
https://github.com/users/lightheaded/projects/2 (project number 2, owner `lightheaded`).

**Always keep the board current.** When you start a feature, move (or create) its card to
*In Progress*; when it ships to main, move it to *Done*. New ideas from the user get a card
in *Todo* — one card per shippable feature, titled imperatively ("Add offline tile cache"),
with a body describing intent and any constraints discussed.

The board is fully scriptable (this is the expected interface for agents):

```sh
gh project item-list 2 --owner lightheaded --format json   # read the board
gh project item-create 2 --owner lightheaded \
  --title "Add offline tile cache" --body "…"              # add a card
gh project item-edit --id <ITEM_ID> \
  --project-id PVT_kwHOADQXbs4BgDWa \
  --field-id PVTSSF_lAHOADQXbs4BgDWazhaRyQ0 \
  --single-select-option-id <OPTION_ID>                    # move a card
```

Status option ids: Todo `f75ad846`, In Progress `47fc9ee4`, Done `98236657`.
(Re-derive with `gh project field-list 2 --owner lightheaded --format json` if they change.)
The token needs the `project` scope (`gh auth refresh -s project,read:project`).

## Project conventions

- GitHub account: **`lightheaded`** — always, for this repo (`gh auth switch -u lightheaded`
  if another account is active). Git identity:
  `Tom Välja <3413870+lightheaded@users.noreply.github.com>`, GPG-signed commits
  (key `C41391CFF4DDCC5E`). Remote via the `github-personal` SSH host alias.
- Every push to `main` deploys to https://bando.lagle.xyz (S3+CloudFront, GitHub OIDC —
  see `infra/main.tf` and `.github/workflows/deploy.yml`). Don't push half-done work.
- The dataset is built by `npm run scrape` (see README). Be polite to register.muinas.ee:
  keep the default delays, never run the pipeline while `npm run dev` is serving (writes
  into `public/` make Vite full-reload continuously).
- Never commit: `data/pdfs/` (338MB archive, lives in S3 under `/pdfs/`), `data/cache/`,
  terraform state, or anything personal. gitleaks runs on every commit.
- `src/types.ts` is the single schema shared by app and scraper; keep it that way.
- Verify UI changes with a real browser (Playwright) on desktop and mobile viewports
  before committing — `window.__map` and `window.__store` are exposed in all builds.
