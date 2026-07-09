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
- **15 open UX Parity issues** (#35–#50, milestone "UX Parity v1 (Foodpanda benchmark)") —
  polish of existing surfaces; **this is the next-session focus** (see "What's next")
- **11 open Functional Parity issues** (#51–#61, milestone "Functional Parity v1") — net-new
  capabilities from the Foodpanda functional cross-reference (filters/sort #51, voucher engine
  #52, combos #53, pickup/scheduled #54, wallet #55, notification inbox #56; growth layer
  loyalty/referrals/subscription/gift-cards #57–#60 decision-gated; vendor reviews+analytics #61).
  **Comes AFTER the customer UX pass** per the founder.

## What's next: FINISH UX PARITY (customer UX first) — this is THE priority

Founder's latest instruction (end of last session): **"finish the UX work first — the app must
tackle Foodpanda, and customer UX is the focus."** So: build out the UX Parity v1 milestone,
customer-facing surfaces before vendor/rider. The Functional Parity milestone (#51–#61, vouchers/
wallet/filters/etc.) is REAL and important but comes AFTER the customer UX pass — do not start it
next session unless the founder redirects.

Program framing: the machinery works but won't survive a side-by-side with Foodpanda. Shift-Ledger-
style human-in-the-loop: one issue per surface (Foodpanda benchmark → our gap → target spec with
every state → decisions → acceptance). **Workflow (#35 UX-00):** decision gate (`needs-decision`
issues wait for a founder comment) → build gate (PR per issue, screenshots mandatory) → verify gate.

**Status of the gates (already cleared — don't re-ask):**
- #35 decisions ANSWERED (see `ux-parity-decisions` memory): keep "KhaanaDo" placeholder, Tailwind-
  only (no Figma), photo strategy = uploaded → Google Places → typography fallback.
- Photo pipeline #50 is BUILT + merged (commit 87ff80f): `<RestaurantImage>`/`<ItemImage>` resolve
  the chain; home feed + restaurant page already consume them. This UNBLOCKS #36 and #38.

**Recommended customer-UX build order for next session:**
1. **#36 home/discovery feed** — cuisine rail, swimlanes, rich cards (photos now available), closed-
   state overlays, "order again", skeletons. The front door.
2. **#38 restaurant page** — the showpiece: **floating cart bar** (highest-leverage conversion
   pattern), scroll-synced category rail, item photos, reviews page, quick-add. Keep our per-
   restaurant 3D theming — it's the one thing Foodpanda can't copy back.
3. **#39→#42 order journey** — item sheet, cart (tip/cutlery/upsell), checkout (address book + map
   pin), tracking (staged tracker + live rider map).
4. **#37 search**, then **#43–#44 auth/account** to round out the customer side.
Vendor console #46, rider #47, and design-system/perf #48–#49 come after the customer journey.

Some customer issues still carry `needs-decision` sub-items (e.g. #40 tip/small-order/pickup, #41
map tiles + scheduled, #43 social login). Surface those inline when you reach the issue — don't
block the whole pass on them; build the non-blocked parts first.

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

1. Read this file + the memory files (`business-model-decisions`, `ux-parity-decisions`,
   `product-scope-decisions`) + skim `README.md`.
2. Confirm `pnpm db` is up on :5455 (see gotchas); it may already be running from a prior session.
3. **Start building customer UX, #36 (home) first, then #38 (restaurant page).** The #35 gate is
   cleared and the photo pipeline (#50) is merged, so these are unblocked. Follow the build-gate
   workflow: implement → screenshots via the preview tools → founder eyeballs before merge.
4. Do NOT start Functional Parity (#51–#61) unless the founder redirects — UX first.
