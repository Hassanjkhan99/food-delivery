# Deploying Herald — free forever (Vercel + Neon)

The GraphQL API is mounted **inside** the Next.js app (`/api/graphql`, plus `/api/uploads`,
`/files/*`, and `/api/cron/*`). So the whole stack is a single deploy — no separate API
server, no cross-site cookies. Two free-forever services carry it:

| Piece         | Service          | Free tier                                    |
| ------------- | ---------------- | -------------------------------------------- |
| Postgres      | **Neon**         | 0.5 GB, autosuspends when idle, wakes in ~1s |
| Web + GraphQL | **Vercel** Hobby | non-commercial; no card required             |

## 1. Database — Neon

1. Create a project at <https://neon.tech> → copy the **pooled** connection string.
2. Run migrations + seed against it from your machine:
   ```bash
   DATABASE_URL="postgres://…neon…/db?sslmode=require" pnpm --filter @fd/db migrate:deploy
   DATABASE_URL="postgres://…neon…/db?sslmode=require" pnpm --filter @fd/db seed
   ```
   (Prisma uses the `pg` driver adapter, which speaks to Neon's pooler fine.)

## 2. Deploy — Vercel

1. Import the repo at <https://vercel.com/new>.
2. **Root Directory → `apps/web`.** Vercel detects Turborepo and installs from the repo root;
   `apps/web/vercel.json` sets the build command (`turbo build --filter=@fd/web...`, which runs
   `prisma generate` for `@fd/db` first) and registers the cron jobs.
3. Set **Environment Variables** (Production + Preview):
   | Var                                                                                  | Value                                                                  |
   | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
   | `DATABASE_URL`                                                                       | the Neon pooled string                                                 |
   | `SESSION_SECRET`                                                                     | a long random string                                                   |
   | `STORAGE_DIR`                                                                        | `/tmp/storage` (only writable path on Vercel)                          |
   | `CRON_SECRET`                                                                        | a random string (Vercel sends it to the cron routes as a Bearer token) |
   | `NODE_ENV`                                                                           | `production` (Vercel sets this automatically)                          |
   | Leave `NEXT_PUBLIC_API_URL` and `OBJECT_STORE_BASE_URL` **unset** — the defaults are |
   | same-origin relative URLs, which is what you want.                                   |
4. Deploy. The app serves the UI and GraphQL from the one `*.vercel.app` origin.

## Known limitations on the free tier (by design)

- **Live subscriptions don't push.** The pubsub is in-memory; Vercel runs each request as a
  separate serverless invocation, so SSE events aren't shared. Queries/mutations work fully;
  live order boards / tracking just don't auto-refresh. (Locally, `next dev` is one process,
  so subscriptions _do_ work.) The fix later is Redis pubsub + a persistent host.
- **Uploads are ephemeral.** Files land in `/tmp` and vanish on redeploy/scale. Swap the
  `ObjectStore` seam (`apps/api/src/services/storage/objectStore.ts`) for Cloudflare R2/S3 for
  durable media.
- **Order-expiry cron is coarse.** Hobby crons run **once a day**, too slow for the 120s
  acceptance SLA. For minute-level expiry, point a free external scheduler
  (e.g. <https://cron-job.org>) at:
  ```
  https://<your-app>.vercel.app/api/cron/expire-orders?secret=<CRON_SECRET>
  ```
  every 1 minute. The daily Vercel cron stays as a backstop.
- **Offer-expiry cron (#168).** Same treatment: point the pinger at
  ```
  https://<your-app>.vercel.app/api/cron/expire-offers?secret=<CRON_SECRET>
  ```
  every 1 minute. Reclaims delivery offers/tasks stuck in `offered` when a rider never
  responds (app closed), so the restaurant board isn't blocked on a dead offer.

## Local development

Collapsed mode is the default — one process serves everything:

```bash
pnpm --filter @fd/db build   # prisma generate (first run)
pnpm --filter @fd/web dev     # UI + GraphQL at http://localhost:3000
```

To run the standalone API again instead, uncomment the standalone block in `.env`
(see `.env.example`) and use `pnpm dev`.
