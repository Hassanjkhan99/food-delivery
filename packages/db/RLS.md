# Row-Level Security (RLS) — restaurant tenant isolation

Issue #33. Defense-in-depth **on top of** the existing resolver-level RBAC + ownership checks:
if a resolver ever forgets an ownership check, Postgres RLS makes the leak return **zero rows**
instead of another tenant's data.

## Status: authored, NOT yet applied or tested (DB was offline)

The migration `prisma/migrations/20260710000128_rls-hardening/migration.sql` and the `withTenant()`
helper in `src/index.ts` were written without a live database. Nothing enforces RLS until the
migration is applied against a cluster whose app role is non-superuser. **Apply + verify before
relying on it.**

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

## Applying + verifying (needs a live DB)

```bash
# 1. embedded dev cluster (creates the NOSUPERUSER `fd` role)
pnpm --filter @fd/db exec node scripts/db-dev.mjs   # or however the dev cluster is started

# 2. apply the migration
pnpm --filter @fd/db exec prisma migrate deploy

# 3. one-time role hardening (as superuser) — uncomment the ALTER ROLE at the bottom of the
#    migration, or run manually:
#    ALTER ROLE fd NOBYPASSRLS;

# 4. verify: connect as `fd`, SET app.current_restaurant_id to restaurant A, confirm a SELECT
#    on branches returns only A's rows; unset it and confirm zero rows.
```

## Follow-ups (out of scope for #33 best-effort)

- A separate `fd_admin` role with `BYPASSRLS` for admin resolvers, wired through context.
- An ESLint rule forbidding raw `prisma.*` access on protected models outside `withTenant`
  (the compliance repo has one — port it once adoption is complete, else it would flag every
  not-yet-migrated resolver).
- Migrate all console resolvers, then flip the wrapper from no-op to required.
