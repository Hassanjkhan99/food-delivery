# Handoff — KhaanaDo (restaurant-first delivery marketplace)

Read this first in any new session. Repo: https://github.com/Hassanjkhan99/food-delivery (private).

## What this project is

Restaurant-first delivery marketplace. Restaurants own menu/prices/acceptance/riders; the
platform owns discovery, ordering, tracking, **and payments** (this was an explicit user
override of the "keep platform out of the money flow" advice in the source research reports —
see `business-model-decisions` memory). Four role UIs in one Next.js app: customer PWA,
restaurant console, rider PWA, admin.

## Locked decisions (do not relitigate without asking)

- Turborepo + pnpm, TypeScript everywhere, no Docker (embedded Postgres instead — see gotchas)
- Next.js 16 App Router `apps/web` :3000, GraphQL Yoga + Pothos `apps/api` :4000, Prisma 7
- Tailwind + shadcn/ui (base-ui flavor), framer-motion for the 3D/motion layer
- Payments: **mocked** Foodpanda-style flow (tokenized saved cards, charge-at-placement,
  auto-refunds) behind a `PaymentProvider` interface — swap in Safepay/PayFast later, see issue #17
- Commission tiered by restaurant type (`small_business` lenient / `chain` 8%), promoted-deals
  schema exists but UI is backlogged (#22)
- Compliance flag (not a build blocker): Punjab PRA's "collecting agent" designation targets
  exactly this payment posture — tax counsel required before real money moves (#18)

## Current state: MVP fully built and shipped

All 12 milestones (M0–M12) done, verified by scripted smoke tests, all green on
build/typecheck/lint/format. 13 commits on `master`. Full detail in commit history and in
`README.md`. GitHub has:
- **12 closed "shipped" issues** (#1–#12) — one per milestone, each documents what was built
- **22 open backlog issues** (#13–#34) — enriched with the full research context from the
  source reports (shared-rider spec, PSP adapter, PRA compliance checklist, observability,
  RLS hardening, etc.) so nothing from the research goes to waste
- **15 open UX Parity issues** (#35–#49, milestone "UX Parity v1 (Foodpanda benchmark)") —
  see "What's next" below

## What's next: UX Parity v1 program

The user's framing: *"it's the shadow of the app I'm thinking of"* — the machinery works but
it won't survive being compared to Foodpanda. We're running a Shift-Ledger-style human-in-the-loop
program: one issue per surface, each with Foodpanda's benchmark pattern → our current gap →
target spec (every state: loading/empty/error/success) → decisions needed → acceptance criteria.

**Workflow (issue #35 UX-00):** decision gate (issues labeled `needs-decision` wait for the
founder's comment before build starts) → build gate (PR per issue, screenshots mandatory) →
verify gate (acceptance criteria checked off before close).

**9 issues are blocked on founder decisions right now** — check
`gh issue list --repo Hassanjkhan99/food-delivery --label needs-decision` or just open #35 first.
Key blocking decisions: real brand name + color (currently placeholder "KhaanaDo" + rose-600),
photo strategy (restaurant-uploaded vs stock vs photo-less launch), design source of truth,
Urdu-at-launch, map tiles (OSM/Leaflet vs Google Maps).

**Recommended build order once #35 is answered:** #36 (home/discovery feed) and #38 (restaurant
page: floating cart bar, scroll-synced menu, reviews, item photos) first — they decide whether a
user ever reaches checkout. Then the order lifecycle chain (#39→#42), then account/help
(#43–#45), then vendor/rider polish (#46–#47), then cross-cutting design system + perf (#48–#49).

Full issue list: `gh issue list --repo Hassanjkhan99/food-delivery --label ux`

## Dev environment — critical gotchas

- **No Docker on this machine.** Postgres runs embedded via `pnpm db` (port **5455**, not 5432).
  Leave that terminal running.
- **Any `pnpm install`/`pnpm add` kills the running embedded-Postgres process** (the binary
  lives in `node_modules`). Restart `pnpm db` after any dependency change.
- **Stopping `pnpm db` via a background-task kill orphans `postgres.exe` child processes**,
  which then block the next `pnpm db` start (it'll say "up" but nothing listens on :5455). Fix:
  ```powershell
  Get-Process postgres -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item ".pgdata\postmaster.pid" -Force -ErrorAction SilentlyContinue
  pnpm db
  ```
- **First run:**
  ```bash
  corepack enable   # or: npm i -g pnpm
  pnpm install
  copy .env.example .env
  pnpm db            # terminal 1, leave running
  pnpm db:migrate    # terminal 2, one-time
  pnpm db:seed       # rebuilds deterministic demo world + prints login cheat-sheet
  pnpm dev           # api :4000 + web :3000
  ```
- Login at `localhost:3000/login` with any seeded number (e.g. `+920000000001` = admin); the
  OTP shows directly on the page in dev mode (`NODE_ENV !== production`).
- Mock cards: `4242 4242 4242 4242` (works), `4000 0000 0000 0002` (always declines).
- After schema changes: `pnpm --filter @fd/db build` (prisma generate) → `pnpm --filter @fd/api
  codegen` (writes `apps/api/schema.graphql`) → `pnpm --filter @fd/web codegen` (client types) —
  in that order, or client codegen reads a stale schema.
- Verification scripts live in `apps/api/scripts/smoke-m*.ts` (run with `npx tsx` while api+db
  are up) and `packages/db/scripts/check-ledger.ts` / `check-seed.ts`.

## Key files to know

- `packages/db/prisma/schema.prisma` — full domain model
- `packages/shared/src/orderStateMachine.ts` — the one source of truth for order transitions
- `apps/api/src/services/orderService.ts` — `transition()` choke point (optimistic guard +
  event + audit + money hooks + pubsub, all one tx)
- `apps/api/src/services/ledgerService.ts` — every money movement, double-entry, must balance
- `apps/api/src/services/payments/provider.ts` + `mockProvider.ts` — the PSP swap seam
- `apps/web/src/proxy.ts` — Next 16's middleware successor, edge role gating
- `apps/web/src/app/(customer)/r/[slug]/page.tsx` — the themed 3D restaurant page

## Memory files (persistent across sessions)

`business-model-decisions.md` in the project memory has the full decision log and status note.
Check it before assuming anything about scope — it's the authoritative record of what the user
explicitly overrode from the source research.

## Immediate next action for a new session

1. Read this file + `business-model-decisions` memory + skim `README.md`.
2. Check `gh issue list --repo Hassanjkhan99/food-delivery --label needs-decision` for any
   decisions the user has since answered (read issue comments).
3. If #35's decisions are answered, start building #36 or #38 per the user's direction that
   turn; otherwise nudge the user toward answering #35 first.
4. Restart `pnpm db` (see gotchas) before touching the database.
