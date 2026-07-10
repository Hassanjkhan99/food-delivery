# KhaanaDo — restaurant-first delivery marketplace

Restaurants own fulfillment (menu, prices, acceptance, riders); the platform owns
discovery, ordering UX, tracking, payments, and the money ledger. Four role UIs live in
one Next.js app: **customer PWA**, **restaurant console**, **rider PWA**, **admin**.

## Stack

Turborepo + pnpm · Next.js (App Router) `apps/web` :3000 · GraphQL Yoga + Pothos
`apps/api` :4000 · PostgreSQL (embedded for dev, no Docker needed) + Prisma 7 ·
Tailwind + shadcn/ui · framer-motion · double-entry ledger · mock payment provider
(Foodpanda-style flow: tokenized saved cards, charge at placement, auto-refunds).

## First run

```bash
corepack enable                 # or: npm i -g pnpm
pnpm install
copy .env.example .env
pnpm db                         # terminal 1: embedded Postgres on :5455 (leave running)
pnpm db:migrate                 # terminal 2
pnpm db:seed                    # demo world + login cheat-sheet
pnpm dev                        # api :4000 + web :3000
```

Sign in at http://localhost:3000/login with any seeded number — the OTP is shown in
dev mode (and printed to the API console):

| Role                                      | Phone             |
| ----------------------------------------- | ----------------- |
| Admin                                     | `+920000000001`   |
| Owner (Karachi Biryani House, Green Bowl) | `+920000000002`   |
| Owner (Burger Theory, Lajawab Bites)      | `+920000000003`   |
| Rider (restaurant)                        | `+920000000005`   |
| Customers                                 | `+920000000007…9` |

Mock cards: `4242 4242 4242 4242` (works) · `4000 0000 0000 0002` (always declines).

## Verification scripts

```bash
# API smoke suites (api server + db must be running)
cd apps/api
npx tsx scripts/smoke-m3.ts    # browse/quote/idempotency/auto-expire (waits 130s)
npx tsx scripts/smoke-m5.ts    # cards, charges, refunds
npx tsx scripts/smoke-m6.ts    # restaurant console lifecycle + draft/publish
npx tsx scripts/smoke-m7.ts    # uploads, CSV import, theming, ratings
npx tsx scripts/smoke-m8.ts    # 3-actor delivery with COD
npx tsx scripts/smoke-m9.ts    # admin flows
npx tsx scripts/smoke-m10.ts   # SSE realtime

# ledger invariants
cd packages/db
npx dotenv -e ../../.env -- tsx scripts/check-ledger.ts
```

## Windows dev notes

- The embedded Postgres binary lives in `node_modules` — **any `pnpm install`/`add`
  kills the running cluster**. Restart `pnpm db` after installing packages.
- If `pnpm db` reports "up" but nothing listens on :5455, orphaned `postgres.exe`
  processes are blocking the cluster:
  `Get-Process postgres | Stop-Process -Force; Remove-Item .pgdata\postmaster.pid`
- Stop the dev servers before `pnpm db:migrate` (Windows file locks).

## Compliance flag (before real-money launch)

Platform-in-the-money-flow is exactly the posture Punjab PRA's collecting-agent
notification targets. Cards are mocked today; before wiring a real PSP
(Safepay/PayFast), get tax counsel on collecting-agent registration, and keep card
data fully outsourced to the PSP (tokens only — the schema already enforces this).

## License & governance

KhaanaDo is a **dual-licensed monorepo**:

- **Core** (`apps/api`, `apps/web`, `packages/db`, `packages/config`) —
  **GNU AGPL-3.0-or-later** ([`LICENSE`](./LICENSE)). Network copyleft: run a modified
  server for others and you must offer them the source.
- **SDK / shareable library** (`packages/shared`) — **Apache-2.0**
  ([`LICENSE-Apache-2.0.txt`](./LICENSE-Apache-2.0.txt)) for ecosystem uptake and a
  patent grant. See [`NOTICE`](./NOTICE) for the exact boundary.

Contributing: read [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branch strategy,
Conventional Commits, and **DCO sign-off** (`git commit -s`, see [`DCO.txt`](./DCO.txt)).
Report vulnerabilities privately per [`SECURITY.md`](./SECURITY.md), never in a public
issue. Sensitive money/policy paths are guarded by
[`.github/CODEOWNERS`](./.github/CODEOWNERS). Be excellent to each other
([`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)).

> **Do not open-source publicly yet** — per the Phase-8 kickoff report, wait until the
> finance / SLA / shared-rider mechanics are battle-tested. These files prepare the repo;
> flipping visibility is a separate, deliberate decision.
