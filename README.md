# Stager

Re-stage Zillow listings in the style of your Pinterest boards

## How it works

1. Add Pinterest boards by URL. Scrapes them via Apify, copies hi-res pin images to Vercel Blob, and persists pin rows in Postgres
2. Submit a Zillow listing URL plus any saved boards. The app pulls the listing photos + address via Apify and titles the run after the address
3. workflow processes every photo async:
   - classify the room with `gemini-2.5-flash`
   - match it to the closest-themed Pinterest board
   - re-stage with Nano Banana using the room photo plus up to six reference pins
   - upload the result to Vercel Blob and update the run row
4. The dashboard and run-detail pages poll Postgres so progress is live as photos finish

## Setup

```bash
npm install
cp .env.example .env.local
# fill in env values, see below
npm run db:push      # push the schema to your postgres
npm run dev
```

### Required environment variables

| Var | Where to get it |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | GitHub Developer Settings -> OAuth Apps. Callback: `<origin>/api/auth/callback/github` |
| `DATABASE_URL` | Vercel Postgres / Neon connection string |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store token |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway (or rely on OIDC in prod) |
| `APIFY_TOKEN` | Apify Console -> Settings -> Integrations |

### Models

Models are configured in `lib/ai.ts`

Default tiers:

- classifier + matcher: `google/gemini-2.5-flash`
- staging Flash: `google/gemini-3.1-flash-image-preview`
- staging Pro: `google/gemini-3-pro-image`

### Local workflow inspection

```bash
npx workflow web              # visual dashboard for runs
npx workflow inspect runs     # cli list
```

## Layout

```
app/                       routes, api, layouts
  (auth)/login             github sign-in
  (app)/                   authed pages (dashboard, boards, runs)
  api/                     route handlers
components/                client components (forms, swr-driven views)
db/schema.ts               drizzle schema
drizzle/                   generated migrations (after `db:generate`)
lib/                       generic helpers (db, auth, blob, apify, ai, zillow, pinterest, classify, staging)
workflows/                 vercel workflows: stage-run, ingest-board
```

## Cost notes

Zillow listings often have 30-50 photos. At Flash tier each photo classify+stage is on the
order of a few cents; Pro hero quality is ~10x
