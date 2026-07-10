# @fd/e2e — Playwright end-to-end smoke suite

Browser-level smoke tests across the four role UIs (customer, restaurant owner,
rider, admin) plus the 3D theme page. The API-level suites (`smoke-m3..m10`)
cover money math and lifecycle; this suite covers the layer they can't reach:
the cart store, checkout form, live boards, auth cookie flow, and theming.

## What's covered

| Spec                 | Journey (smoke depth)                                            |
| -------------------- | ---------------------------------------------------------------- |
| `customer.spec.ts`   | dev-OTP login, home feed, open restaurant, cart + checkout reach |
| `restaurant.spec.ts` | live order board, menu manager + publish control                 |
| `rider.spec.ts`      | rider hub, online/offline toggle, offers/active-jobs sections    |
| `admin.spec.ts`      | marketplace overview KPIs, approvals + refunds surfaces          |
| `theme.spec.ts`      | `/r/[slug]` themed page renders + degrades under reduced-motion  |

Tests are **resilient**: if the API is unreachable they `skip` with a clear
message instead of drowning in selector timeouts (see `src/fixtures.ts`), and
data-dependent drill-ins are guarded so an empty seed feed won't red the suite.

## Auth (no SMS)

`src/auth.ts` logs in via the dev-OTP path: `requestOtp` returns `devCode`
outside production, which is fed straight to `verifyOtp`. The session cookie is
host-only for `localhost`, so it applies to both `:3000` (web) and `:4000`
(api). Seed identities live in `src/seed-world.ts`.

## Running locally

You need the stack up first (embedded PG + seed + dev servers):

```sh
# terminal 1 — embedded Postgres (persistent .pgdata)
pnpm db
# one-time: apply migrations + seed
pnpm db:migrate && pnpm db:seed
# terminal 2 — dev servers (web :3000, api :4000)
pnpm dev
# terminal 3 — the suite
pnpm --filter @fd/e2e e2e:install   # first run only: fetches Chromium
pnpm --filter @fd/e2e e2e
```

Or let Playwright boot the dev servers itself (when a DB is already up):

```sh
E2E_WEB_START=1 pnpm --filter @fd/e2e e2e
```

### Env overrides

| Var             | Default                         | Purpose                            |
| --------------- | ------------------------------- | ---------------------------------- |
| `E2E_WEB_URL`   | `http://localhost:3000`         | web base URL                       |
| `E2E_API_URL`   | `http://localhost:4000/graphql` | GraphQL endpoint for auth/probe    |
| `E2E_WEB_START` | _(unset)_                       | `1` → Playwright starts `pnpm dev` |

## CI

`e2e/scripts/ci-db.mjs` boots a throwaway embedded PG cluster, runs
`prisma migrate deploy`, seeds, and stays alive. The CI job then starts the dev
servers and runs Playwright against them. See `.github/workflows/ci.yml`
(`e2e` job).
