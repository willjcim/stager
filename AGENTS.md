# Stager — Agent Context

Re-stage Zillow listings in the style of a user's Pinterest boards.

## Stack

- Next.js 16 App Router (Turbopack)
- React 19, Tailwind v4
- Postgres via `drizzle-orm` (postgres-js driver)
- `next-auth` v5 (GitHub OAuth, Drizzle adapter, DB sessions)
- `workflow` (Vercel Workflow DevKit) for durable async work
- `ai` SDK + Vercel AI Gateway (Gemini 2.5 Flash for classify/match, Gemini 3 Flash/Pro for staging)
- `@vercel/blob` for image storage
- `apify-client` (or raw fetch) for Zillow + Pinterest scraping
- `pdf-lib` + `sharp` for PDF export

## How the system works end-to-end

1. **Boards**: user adds a Pinterest board URL → `ingestBoardWorkflow` scrapes via Apify, copies hi-res pin images to Blob, persists pins in `pinterest_pin`, marks the board `ready`.
2. **Run creation**: user submits Zillow URL + selected boards + flash/pro tier → `POST /api/runs` inserts a `run` row + `run_board` joins, kicks off `stageRunWorkflow`, stores parent `workflow_run_id` on the run.
3. **Run orchestration** (`workflows/stage-run.ts`):
   - Fetch listing (address + photo URLs) via Apify
   - Insert one `run_photo` row per photo (status `queued`)
   - Load reference boards + their pins
   - Fan out N child workflows via `start(processPhotoWorkflow, …)` — store each child `workflow_run_id` on its `run_photo` row
   - Poll `run_photo` settlement + `run.status == 'cancelled'` every 10s, up to 180 polls
   - Finalize as `done` | `failed` | `cancelled`
4. **Per-photo pipeline** (`workflows/process-photo.ts`):
   - One fat step per child workflow: classify → match → stage → upload to Blob → mark photo `done`
   - Step never throws — failures are recorded on the row
   - Checks `runs.status == 'cancelled'` at three boundaries (entry, post-classify, pre-stage) and short-circuits to `cancelled`
5. **Live UI**: `RunDetail` polls `/api/runs/[id]` every 2s; stops at terminal status.
6. **Completed runs**: can be exported (PDF), shared (public token URL), and deleted. Photos open in a click-to-toggle lightbox.

## Why the workflow is shaped this way (do not "simplify")

Earlier designs ran the per-photo pipeline as either many sequential steps inside the parent (264+ events) or N concurrent fat steps inside the parent. Both produced **"Unconsumed event in event log"** runtime errors on Vercel because:
- WDK uses at-least-once delivery; concurrent lambdas race on the same event log
- Long-running concurrent steps (~30–60s) keep the workflow active for minutes, multiplying the racing window
- The parent's event log grew large enough to amplify the race

The current design — child-workflow fan-out via `start()` from inside a single step, plus a single fat step inside each child — keeps every event log trivially small and is the WDK-recommended pattern. Don't refactor this away.

## Directory layout

```
app/
  (app)/                    authed pages (dashboard, boards, runs)
  (auth)/login              github sign-in
  api/                      route handlers
    runs/[id]/cancel        POST cancel an in-flight run
    runs/[id]/share         POST create / DELETE revoke share token
    runs/[id]/export        GET PDF download (Node, maxDuration 300)
    share/[token]           public read-only run JSON
  share/[token]/page.tsx    public read-only run page (no auth layout)
components/                 client components (SWR-driven)
db/schema.ts                drizzle schema
drizzle/                    migrations (we use db:push, see Migrations)
lib/                        helpers (db, auth, blob, apify, ai, classify, staging, zillow, pinterest, pdf)
workflows/                  vercel workflows (stage-run, process-photo, ingest-board)
```

## Conventions

### Comment style

**No punctuation in code comments.** No `.` `,` `:` `;` `?` `!` `'`. Hyphens, arrows (`->`), parens, backticks, slashes, and equals are fine.

Function header is **a single short line**. No `step:` or `// fnName()` ceremony. Multi-line headers are reserved for genuine architectural rationale.

```ts
// classify a room photo into a coarse type with confidence
export async function classifyPhotoStep(input) { ... }

// flip db status then best-effort cancel parent + child workflows
export async function POST(req) { ... }
```

Apply to TypeScript/JS only — markdown (this file), prompt strings, and JSX user-facing text are normal English.

### Workflow code

- Top-level workflow functions: `"use workflow"` directive
- Step functions: `"use step"` directive
- Step functions called from inside another step run **inline** — no nested event log entries, no separate retry layer. This is intentional and how the per-photo pipeline stays in one event.
- Never throw from a child workflow's main step — record failure on the DB row instead so the workflow always exits cleanly.
- Persist any workflow `runId` you may want to cancel later (we do this on `runs.workflow_run_id` and `run_photos.workflow_run_id`).

### Auth + queries

- Every API route starts with `const session = await auth()` + `if (!session?.user?.id) return 401`.
- All user-scoped queries gate on `eq(table.userId, session.user.id)`.
- Public endpoints (`/api/share/[token]`, `/share/[token]`) only expose runs with `status === 'done'` and never include `zillowUrl` or workflow internals.

### Status enums

- `run_status`: `queued | running | done | failed | cancelled`
- `photo_status`: `queued | classifying | matched | staging | done | failed | cancelled`
- "Active" filters mean `status in (queued, running)`. "History" means `status in (done, failed, cancelled)`.

### Migrations

We use **`npm run db:push`**, not `db:migrate`. `ALTER TYPE … ADD VALUE` cannot run inside a transaction (which is what drizzle's `migrate` does). Generated migration files in `drizzle/` are kept for schema history only.

If you add an enum value:
1. Edit `db/schema.ts`
2. Run `npm run db:push`
3. Do NOT commit a generated migration file unless you split the enum ALTER into its own non-transactional file

### Models

Configured in `lib/ai.ts`. Routed through Vercel AI Gateway so swapping is one line.
- Classifier + matcher: `google/gemini-2.5-flash`
- Staging Flash: `google/gemini-3.1-flash-image-preview`
- Staging Pro: `google/gemini-3-pro-image`

Tag all gateway calls with `tags: ["feature:..."]` (and `tier:flash|pro` for staging) so usage shows up grouped in the dashboard.

### Blob layout

`{kind}/{userId}/{...}` — see `lib/blob.ts#blobPath`. Kinds: `boards | runs | tmp`.

## Common commands

```bash
npm run dev               # next dev (Turbopack)
npm run build
npm run db:push           # apply schema (NOT db:migrate, see above)
npm run db:studio         # drizzle studio
npm run workflow:web      # local workflow dashboard
npm run workflow:inspect  # cli list of runs
npx tsc --noEmit          # typecheck
npx eslint .              # lint
```

## Environment

Required env vars (see `.env.example`):
- `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
- `DATABASE_URL` (Postgres / Neon)
- `BLOB_READ_WRITE_TOKEN` (only when Blob store is in another project)
- `AI_GATEWAY_API_KEY` (omit in prod — OIDC handles it)
- `APIFY_TOKEN`
- `AUTH_URL` in prod (NextAuth needs the public origin for callback URLs)

## Gotchas

- **Don't fan out long-running steps directly inside a workflow.** See workflow rationale above. Use `start(childWorkflow, …)` from inside a single step.
- **Don't use `db:migrate`** for enum changes (transaction error). Use `db:push`.
- **Cancel is best-effort + DB-driven.** `POST /api/runs/[id]/cancel` flips `runs.status='cancelled'` first (source of truth), then calls `getRun(id).cancel()` on parent + every recorded child runId. The workflow code itself polls the row at safe boundaries, so even if `getRun().cancel()` fails the run stops promptly.
- **PDF export needs `maxDuration = 300`** + Node runtime. On Hobby this caps at 60s; for large runs move to background generation (write to Blob, redirect).
- **`processPhotoStep` must never throw.** Record failure on the row so the child workflow exits cleanly. Throwing risks workflow-level retries on already-completed work.
- **Share link visibility** is fully public — anyone with the token can view. Token is `randomBytes(24).toString('base64url')`. Revocation just nulls the column.
