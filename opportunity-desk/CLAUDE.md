# Opportunity Desk

Internal tool for qualifying sales opportunities by **solution fit, value and risk**, so sales, presales and leadership agree on what to pursue and with which product. It started as a claude.ai artifact prototype and was migrated to this codebase.

> **Status: the simplified "deal tracker" UI (Board, deal card with update history) was built and then rolled back.** The running frontend is the Pipeline UI (Executive/Operational) with Tasks. The deal-tracker frontend is archived, complete and working, in `archive/deal-tracker-ui/` (copy it over `public/` to restore it). The **server side of the tracker stayed**: the `updates` table and API, the startup migration, and the deal rules in `public/deals.js`. The current UI does not use them yet.

## Run

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY to enable AI drafting
npm run dev               # http://localhost:3000, restarts on change
npm test                  # node:test, no extra deps
npm run seed              # wipe the DB and reload seed/*.json
```

Docker: `docker compose up -d --build` serves the app on http://localhost:3000 with data in the `opportunity-data` volume. `Dockerfile` points node-gyp at the headers bundled in the Node image (`npm_config_nodedir`) so the build works behind TLS-intercepting proxies. Run tests in the image with `docker compose run --rm app node --test`.

## Architecture

- `server/index.js` – Express 5 app. REST API under `/api`, serves `public/` statically. `createApp(db)` is exported for tests.
- `server/db.js` – SQLite (better-sqlite3). Collections `opps` and `products` are a document store (one JSON record per row in `data`); deal history lives in a real `updates` table. Seeds empty tables from `seed/*.json` on startup, then runs the migration.
- `server/migrate.js` – startup migration to the deal-tracker model. Idempotent (running it twice changes nothing): `Discovery` → `New`; `next` → `nextStep` (only when `nextStep` is unset); each `status` becomes the deal's first update (id `mig-<oppId>`, `created_at` = `statusAt`, author "Imported"); `lastActivityAt` is filled from `statusAt`/`updatedAt`/`createdAt`. Old fields (`status`, `statusAt`, `next`) are left in place.
- `server/ai.js` – `POST /api/ai/draft`: builds the prompt from pasted RFP/email text plus the product catalog, calls the Anthropic Messages API, returns the parsed JSON draft. The key stays server-side. Model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
- `public/` – no build step, plain ES modules.
  - `app.js` – all UI: views, rendering (template strings into `#view`), API client, form handling.
  - `scoring.js` – scoring rules, shared with tests. **Change scoring here only.**
  - `tasks.js` – task workstreams/statuses and helpers. Shared with tests.
  - `deals.js` – tracker stages (`New, Qualified, Proposal, Won, Lost`), `STUCK_DAYS`, overdue/stuck rules, `DEFAULT_DOMAINS`. Imported by the server (stage validation, migration, AI prompt) and tests; not by the current UI.
  - `styles.css` – design tokens on `:root` with light/dark themes; IBM Plex Sans / Condensed / Mono.
- `archive/deal-tracker-ui/` – the rolled-back deal-tracker frontend (`board.js`, `deal.js`, `newdeal.js`, `settings.js`, `state.js`, `api.js`, `util.js`, `insights.js`, plus its `app.js`, `index.html`, `styles.css`). Not served and excluded from the Docker image.

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | `{ ai: boolean }` |
| GET/POST | `/api/:coll` | `coll` = `opps` or `products` |
| GET/PUT/DELETE | `/api/:coll/:id` | PUT replaces the whole record. Deleting an opp also deletes its updates. |
| GET | `/api/opps/:id/updates` | History, newest first: `[{id, oppId, author, kind, text, nextStep, dueDate, createdAt}]`. 404 for an unknown deal. |
| POST | `/api/opps/:id/updates` | `{ author, text?, nextStep?, dueDate?, stage? }` → `201 { update, opp }`. One transaction: adds the entry and sets the deal's `lastActivityAt`, plus `nextStep`/`dueDate` when those keys are sent. A `stage` different from the current one makes a `kind: "stage"` entry whose text is generated (`Stage: New → Qualified`) and moves the deal. 400 when `author` is empty, `dueDate` isn't `YYYY-MM-DD`, `stage` is unknown/unchanged with nothing else to record, or there is neither text nor next step. |
| POST | `/api/ai/draft` | `{ text }` → draft opportunity JSON; errors `{ code, error }` |
| POST | `/api/ai/status` | `{ id }` → `{ text }`: a 1–3 sentence latest status Claude writes from the saved deal's task statuses (overdue is computed server-side, not by the model). Returns text only; the client saves it with a normal PUT. 404 unknown deal, 400 `no_tasks`, 503 `ai_unavailable`. |

## Domain model

**Stages:** the tracker model is New → Qualified → Proposal → Won / Lost (`STAGES` in `public/deals.js`; this is what the server validates). The current UI still offers its older list (New, Discovery, Qualified, Proposal, Won, Lost). **The startup migration rewrites Discovery to New**, so a deal set to Discovery in the UI becomes New at the next server restart.

An opportunity (`opps`) stores:
- **Core:** `title, client, owner, stage, valueM` (deal size, USD millions), `nextStep, dueDate` (`YYYY-MM-DD` or `""`), `lastActivityAt` (ISO time of the last posted update or stage change).
- **Optional detail:** `domain, source, timeline, valueScore` (0–100), `need`, and lists:
  - `products: [{n, f, note}]` – product name, fit 0–100, reason
  - `stakeholders: [{n, r, i, s}]` – name/title, role, influence H/M/L, stance Champion/Neutral/Blocker/Unknown
  - `risks: [{c, l, note, m}]` – category, level H/M/L, detail, mitigation
  - `gaps: string[]`, `strategic: string[]`
  - `tasks: [{id, ws, t, owner, due, status}]` – `ws` is a workstream (Solution design, Demo, Proposal, Pricing, Security questionnaire), `status` is To do / In progress / Blocked / Done.
- **Latest status (current UI):** `status` (text), `statusAt`, and `statusSource` — `"ai-tasks"` when the text was written by Claude from task statuses and accepted by a person, otherwise `""`/absent. Editing the status text in the form clears it. Shown as an "AI-generated from task status" sign next to the status.
- **Legacy (also used by the current UI):** `next` is the "Next action" text.
- `example: true` marks seed data.

An update (`updates` table): `id, opp_id, author, kind ("note" | "stage"), text, next_step, due_date, created_at`.

**Flags** (open deals only; `public/deals.js`): **Overdue** = `dueDate` is before today. **Stuck** = no update for `STUCK_DAYS` (14) or more days; measured from `lastActivityAt` (falling back to older date fields). Editing owner/value/details does not count as activity.

**Scoring** (`public/scoring.js`, unchanged): fit = best product fit; risk = sum of H 30 / M 15 / L 5, capped at 100; score = 0.4·fit + 0.35·valueScore + 0.25·(100 − risk); Go ≥ 70, Qualify 55–69, No-go < 55. Shown only as the badge on cards and inside Details.

**Domains** (`DEFAULT_DOMAINS` in `public/deals.js`, also used by the AI prompt): Smart City, Energy, Finance, Retail. The board's domain filter lists whatever domains the deals actually use.

## UI

Currently running:
- **Header**: the Pipeline / Products toggle sits top right, above the "+ New opportunity" button.
- **Pipeline › Executive**: fit-vs-value quadrant (split at 50) beside a stack of the stage funnel and deal-size buckets (both clickable cross-filters); the three cards share the same top and bottom edges. Below: lead list + status card (latest status, next action, Tasks line). There is no KPI strip.
- **Pipeline › Operational**: ranked queue + full assessment card (Latest status with a "Write from task status" button, Next action, a collapsible Tasks section grouped by workstream and closed by default, then tabs in the order Value, Solution fit, Stakeholders, Risks), edit/delete.
- **Next action is one of the tasks**: `nextAction()` in `public/tasks.js` picks it — the open (not Done) task that isn't Blocked with the earliest due date (undated last, then list order); if every open task is Blocked, the earliest blocked one. The Operational card shows it with a "Mark done" button, which advances to the next task. Deals with no tasks fall back to the free-text `next` field; deals whose tasks are all done show "All tasks done". "Write from task status" shows Claude's draft for review ("Use this status" / "Discard"); a draft is dropped if tasks change before it is accepted.
- **New/Edit opportunity**: form with pipe-separated lines for lists; "Draft with Claude" fills it from pasted text. Saving keeps `tasks`, `nextStep`, `dueDate` and `lastActivityAt`, which the form doesn't edit.
- **Products**: catalog the AI matches against.

Archived (`archive/deal-tracker-ui/`), described here so it can be restored:
- **Board** (home): kanban columns by stage; Won and Lost start collapsed. Card: title, client, deal size, owner, next step + due date, Go/Qualify/No-go badge, and text-labelled flags (Overdue, Stuck · Nd). Drag a card to another column, or use the stage dropdown on the card (keyboard/mobile); either posts a stage update. Top bar: My deals / All (owner matches the saved name, case-insensitive), domain filter, and a summary line (open pipeline value, overdue count, stuck count). Columns scroll horizontally on phones.
- **Deal card** (click a card; side panel on desktop, full screen on phones): inline-editable title, client, stage, owner and deal size; **Latest update + next step** shown together; **Post an update** (What happened, Next step, Due — prefilled with the current values; posting replaces next step/due and logs history); History (newest first, includes stage changes); **Tasks** (collapsed by default, grouped by workstream, inline status); **Details** (collapsed by default: domain, timeline, source, value score, need, add/remove rows for products, stakeholders, risks, strategic value and gaps, score breakdown, and "Draft with Claude", which fills the fields for review and saves nothing until "Save details").
- **New deal:** title, client, owner, deal size required; stage defaults to New; optional first next step + due. Creates a "Deal created" history entry and opens the card.
- **Settings:** product catalog the AI matches against.
- **Author:** there is no login. The name typed in the top-bar "You" box is kept in `localStorage` (`od-author`), signs updates and drives "My deals".

## Conventions

- Keep the frontend dependency-free unless there's a strong reason; no bundler.
- Escape all user/AI text with `esc()` before putting it in HTML.
- Colors only via CSS tokens in `styles.css`; check both light and dark themes. Flags and statuses use a text label, never color alone.
- Layout must work at phone width (~400px).
- Add a test in `test/` for any change to scoring, deal rules, the migration or the API.

## Not done yet (prototype gaps)

- **No authentication or authorization** – anyone who can reach the server can read and edit, and "author" is just a name typed in the browser. Put it behind company SSO before sharing beyond localhost.
- History records updates and stage changes only; edits to other fields (owner, value, details, tasks) are not logged.
- Polling every 20 s instead of live updates; an open deal card is not refreshed by polling.
- Scoring weights are hard-coded.

## Roadmap

1. Pilot: real product catalog, one department, 20–30 live deals; adjustable scoring weights; win/loss capture.
2. Scale: SSO, CRM integration, on-prem deployment option, audit trail for all field edits, gap-to-roadmap analytics, similar-deal suggestions, bring back the insights charts (`public/insights.js`).
