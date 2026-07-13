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

## Known limitations of the pure-Vercel tier (and how each is now fixable)

The code now ships the fix for all three; they activate purely by env vars once you stand
up the persistent API (see **Production unlock** below). Left unset, behaviour is unchanged.

- **Live subscriptions don't push.** The pubsub is in-memory; Vercel runs each request as a
  separate serverless invocation, so SSE events aren't shared. Queries/mutations work fully;
  live order boards / tracking just don't auto-refresh. (Locally, `next dev` is one process,
  so subscriptions _do_ work.) **Fix:** set `REDIS_URL` on the persistent API — the pubsub
  swaps to a Redis event target (`apps/api/src/pubsub.ts`) and SSE fans out across instances.
- **Uploads are ephemeral.** Files land in `/tmp` and vanish on redeploy/scale. **Fix:** set
  `STORAGE_DRIVER=r2` + the `R2_*` vars — uploads presign straight to Cloudflare R2
  (`apps/api/src/services/storage/r2Store.ts`) and persist.
- **No out-of-app notifications.** The inbox (`notifications` table) is in-app only. **Fix:**
  the fan-out pipeline (`apps/api/src/services/notifications/`) delivers each inbox message
  via web push / email / WhatsApp / SMS. Every channel is off until its flag + keys are set,
  so it costs nothing until launch.
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

## Production unlock — persistent API + Redis + R2 (free-tier friendly)

When you're ready to launch (real users, real media, out-of-app alerts), split the API
onto a persistent host. The web app stays on Vercel; only realtime/uploads/notifications
move. All free tiers.

1. **Redis (Upstash)** — create a database at <https://upstash.com>, copy the `rediss://`
   URL. This is what makes SSE push across invocations.
2. **Object storage (Cloudflare R2)** — create a bucket + an S3 API token at
   <https://dash.cloudflare.com> → R2. Note the account endpoint and a public URL for reads.
3. **API host (Render)** — `render.yaml` at the repo root is a ready Blueprint. New →
   Blueprint → pick the repo. It builds `apps/api` and runs `pnpm --filter @fd/api start`
   (the standalone `server.ts`, which also runs the expiry/offer/trust sweepers). Fill the
   `sync:false` env vars. The free instance sleeps after 15m idle — upgrade to Starter at
   launch so SSE and the sweepers stay alive.
4. **Point the web app at it — via a shared parent domain (required).** The web edge
   proxy (`apps/web/src/proxy.ts`) role-gates by reading the `fd_session` cookie, so that
   cookie must be readable by **both** the web origin and the API origin. That only works
   when they're sibling subdomains of one registrable domain:
   - Put the web app on `app.<your-domain>` (Vercel custom domain) and the API on
     `api.<your-domain>` (Render custom domain).
   - On Vercel: `NEXT_PUBLIC_API_URL = https://api.<your-domain>/graphql`.
   - On Render: `WEB_ORIGIN` + `PUBLIC_WEB_URL = https://app.<your-domain>` (CORS + deep
     links), and `SESSION_COOKIE_DOMAIN = <your-domain>` (the **bare** parent, no leading
     dot — RFC 6265 scopes it to every subdomain) so the one session cookie is shared.
     `SESSION_COOKIE_SAMESITE` stays `lax` — subdomain requests are same-site, so Lax
     cookies flow and no third-party-cookie blocking applies.

   ⚠️ Do **not** try to run this with the raw platform hostnames (`*.vercel.app` +
   `*.onrender.com`): they're different registrable domains, so the cookie can't be shared
   and browsers block it as third-party. A custom domain is the supported cutover path.
   Verify login + a role-gated route (e.g. `/orders`) before sending real traffic.

### Launch checklist — enabling notifications (flip a flag, no deploy)

Everything is wired and off. To turn a channel on, set its keys then flip its flag on the
API host:

| Channel  | Set these keys                                                                  | Then flip            | Cost      |
| -------- | ------------------------------------------------------------------------------- | -------------------- | --------- |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` + Vercel `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `NOTIFY_WEBPUSH=on`  | free      |
| Email    | `RESEND_API_KEY`, `EMAIL_FROM`                                                  | `NOTIFY_EMAIL=on`    | free tier |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` (+ approved templates)                    | `NOTIFY_WHATSAPP=on` | paid      |
| SMS      | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`                        | `NOTIFY_SMS=on`      | paid      |

Generate a VAPID keypair once with `npx web-push generate-vapid-keys`. A channel with its
flag on but keys missing stays inert (safe). Users opt into push from **Account → Push
notifications** (the control self-hides until `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set).

## Local development

Collapsed mode is the default — one process serves everything:

```bash
pnpm --filter @fd/db build   # prisma generate (first run)
pnpm --filter @fd/web dev     # UI + GraphQL at http://localhost:3000
```

To run the standalone API again instead, uncomment the standalone block in `.env`
(see `.env.example`) and use `pnpm dev`.
