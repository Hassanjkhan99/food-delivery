# Row-Level Security (RLS) — restaurant tenant isolation

Issue #33. Defense-in-depth **on top of** the existing resolver-level RBAC + ownership checks:
if a resolver ever forgets an ownership check, Postgres RLS makes the leak return **zero rows**
instead of another tenant's data.

## Status: DESIGNED ONLY — no migration exists, RLS is unenforced (issue #130 open)

There is **no RLS migration in this repo**. An earlier note referenced
`prisma/migrations/20260710000128_rls-hardening/migration.sql`, but that migration was never
committed — the `migrations/` directory contains no `CREATE POLICY` / `FORCE ROW LEVEL SECURITY`
SQL. The `withTenant()` helper in `src/index.ts` sets the tenant GUC but is a **functional no-op**
without policies, so **tenant isolation is currently enforced only by the resolver-level RBAC +
ownership checks** (which is the app's actual guarantee today).

Applying FORCE RLS naively would **break four working paths** — this is why #130 is deferred rather
than shipped half-built. Any future migration MUST handle all four (see next section) and be
validated against the dev cluster before merge.

## Design blockers before any FORCE-RLS migration (issue #130)

A migration that puts the tables below under `FORCE ROW LEVEL SECURITY` with only a
tenant-GUC policy would break these paths. Each needs an explicit policy/connection decision,
encoded in the migration and validated on the dev cluster:

1. **Public marketplace reads.** `browseBranches` / `branchBySlug` / `searchMarketplace` and the
   whole customer menu-browse path (`branches`, `restaurants`, `menus`, `menu_items`, …) read on
   the plain client with no tenant GUC. Under FORCE RLS every public read returns zero rows.
   → The policy set MUST include a **public-read policy** (e.g. `USING (status = 'approved')` for
   branches/restaurants and menu tables), or those tables must be excluded from FORCE. This matches
   the "marketplace reads stay on resolver authz" scope below — it just has to be encoded, not implied.
2. **Tenant bootstrap (`submitOnboarding`).** Creating a restaurant + first branch happens with no
   tenant context (the id doesn't exist yet), so a `restaurants` `WITH CHECK (id = current_...)`
   write policy rejects the insert. → Bootstrap must run on a BYPASSRLS/owner connection, or a
   dedicated bootstrap policy must allow the initial insert.
3. **Admin cross-tenant reads (`payoutHistory`, etc.).** Admin resolvers run on the plain client
   outside `withTenant` (correct — admin has no single restaurantId). Under FORCE RLS with no admin
   role they see zero rows. → Needs the **`fd_admin` BYPASSRLS role** wired through context (see
   Follow-ups) before admin surfaces can rely on RLS.
4. **Customer rating writes (`rateOrder`).** Insert into `ratings` happens outside `withTenant`
   (NULL GUC) and fails a `WITH CHECK`. → `ratings` needs a customer-insert-allowed policy (or set
   the order's restaurant tenant for that insert), tied to decision (1).

## How it works

Tenancy here is **restaurant-scoped**. `withTenant(restaurantId, fn)` opens a transaction and sets
a transaction-local GUC:

```ts
import { withTenant } from "@fd/db";

const payouts = await withTenant(restaurantId, (tx) =>
  tx.payout.findMany({ where: { restaurantId }, orderBy: { createdAt: "desc" } }),
);
```

Inside the transaction, `set_config('app.current_restaurant_id', restaurantId, true)` is set. Every
policy resolves the row's owning restaurant and compares it to that GUC. A query issued **outside**
`withTenant()` has no GUC set → `current_setting(..., true)` is `NULL` → every policy is false →
default-deny.

## Scope of the policies

Restaurant-**owned** tables only:

- Direct (`restaurantId`/`id`): `restaurants`, `branches`, `restaurant_themes`, `payouts`,
  `ratings`, `campaigns`
- Via branch: `branch_hours`, `menu_source_docs`, `menus`
- Via menu → branch: `menu_categories`, `modifier_groups`, `menu_items`, `modifier_options`,
  `menu_item_modifier_groups`

**Not** under RLS (cross-tenant by nature; stay on resolver authz): global marketplace reads,
customers, riders, orders, ledger, admin surfaces.

## Adoption path (incremental — safe to do resolver-by-resolver)

Until every restaurant-owned read/write goes through `withTenant`, the wrapper is a no-op layered on
top of the current checks, so it can be adopted gradually. Start with the console query paths in
`apps/api/src/schema/restaurant.ts` (payouts, wallet, menu CRUD). Because Pothos `t.prismaField`
passes a `query` object into the prisma call, wrap the returned promise:

```ts
resolve: (query, _root, args, ctx) => {
  if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("Not a member of this restaurant");
  }
  // Admin cuts across tenants and has no single restaurantId → it must run OUTSIDE
  // withTenant (and therefore needs a BYPASSRLS/owner connection). Only tenant users
  // go through the wrapper:
  if (ctx.hasRole("admin")) {
    return prisma.payout.findMany({ ...query, where: { restaurantId: args.restaurantId } });
  }
  return withTenant(args.restaurantId, (tx) =>
    tx.payout.findMany({ ...query, where: { restaurantId: args.restaurantId } }),
  );
},
```

## Applying + verifying (needs a live DB) — once the migration is authored

No migration exists yet (see Status). When one is written it must implement all four design
blockers above; then:

```bash
# 1. embedded dev cluster (creates the NOSUPERUSER `fd` role)
node scripts/db-dev.mjs   # leave running

# 2. apply the migration
pnpm --filter @fd/db migrate:deploy

# 3. one-time role hardening (as superuser):
#    ALTER ROLE fd NOBYPASSRLS;   and create the fd_admin BYPASSRLS role (blocker #3)

# 4. verify EACH blocker path end-to-end, not just tenant isolation:
#    - as `fd` with app.current_restaurant_id = A → SELECT on branches returns only A's rows;
#      unset it → still returns approved rows (public-read policy), NOT zero;
#    - submitOnboarding creates a restaurant (bootstrap path);
#    - admin payoutHistory (fd_admin) returns rows;
#    - a customer rateOrder insert succeeds.
```

## Follow-ups (out of scope for #33 best-effort)

- A separate `fd_admin` role with `BYPASSRLS` for admin resolvers, wired through context.
- An ESLint rule forbidding raw `prisma.*` access on protected models outside `withTenant`
  (the compliance repo has one — port it once adoption is complete, else it would flag every
  not-yet-migrated resolver).
- Migrate all console resolvers, then flip the wrapper from no-op to required.
