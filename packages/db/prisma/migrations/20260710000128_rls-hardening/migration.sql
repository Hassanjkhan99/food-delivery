-- Postgres Row-Level Security hardening (issue #33) — defense-in-depth over resolver RBAC.
--
-- ⚠️ AUTHORED WITH THE DB OFFLINE — NOT YET APPLIED OR TESTED. This is a --create-only
-- migration. Apply + verify against the embedded dev cluster before relying on RLS:
--   pnpm --filter @fd/db exec prisma migrate deploy   (or `migrate dev` on a fresh shadow DB)
-- The dev app role (`fd`, scripts/pg.mjs) is already NOSUPERUSER, so FORCE RLS enforces
-- locally. It is NOT NOBYPASSRLS by default — see the ALTER ROLE at the bottom; run it once
-- (as superuser) so the app role cannot bypass its own policies.
--
-- Model: tenancy here is RESTAURANT-scoped. The app opens a transaction and sets the
-- transaction-local GUC `app.current_restaurant_id` (see withTenant() in @fd/db). Each policy
-- below resolves each table's owning restaurant and compares it to that GUC. With no GUC set
-- (any query issued outside withTenant), current_setting(..., true) is NULL and every policy
-- evaluates false → default-deny (zero rows), which is the point of defense-in-depth.
--
-- Scope: restaurant-OWNED tables only (menus, branches, themes, payouts, ratings, campaigns and
-- the menu sub-tree). Global marketplace/customer/rider/admin reads are intentionally NOT under
-- RLS — those cut across tenants and stay on resolver-level authz. Admin surfaces must run
-- OUTSIDE withTenant() and therefore require BYPASSRLS (grant a separate admin role, or keep
-- admin on the superuser/owner connection — a follow-up).

-- Helper: the restaurant id for the current transaction, or NULL when unset.
CREATE OR REPLACE FUNCTION app_current_restaurant_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_restaurant_id', true), '') $$;

-- ─────────────────────────── directly restaurant-scoped ───────────────────────────

ALTER TABLE "restaurants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "restaurants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "restaurants"
  USING ("id" = app_current_restaurant_id())
  WITH CHECK ("id" = app_current_restaurant_id());

ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "branches"
  USING ("restaurantId" = app_current_restaurant_id())
  WITH CHECK ("restaurantId" = app_current_restaurant_id());

ALTER TABLE "restaurant_themes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "restaurant_themes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "restaurant_themes"
  USING ("restaurantId" = app_current_restaurant_id())
  WITH CHECK ("restaurantId" = app_current_restaurant_id());

ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payouts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payouts"
  USING ("restaurantId" = app_current_restaurant_id())
  WITH CHECK ("restaurantId" = app_current_restaurant_id());

ALTER TABLE "ratings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ratings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ratings"
  USING ("restaurantId" = app_current_restaurant_id())
  WITH CHECK ("restaurantId" = app_current_restaurant_id());

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaigns"
  USING ("restaurantId" = app_current_restaurant_id())
  WITH CHECK ("restaurantId" = app_current_restaurant_id());

-- ─────────────────────────── branch-owned (restaurant via branch) ───────────────────────────

ALTER TABLE "branch_hours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch_hours" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "branch_hours"
  USING (EXISTS (
    SELECT 1 FROM "branches" b
    WHERE b."id" = "branch_hours"."branchId" AND b."restaurantId" = app_current_restaurant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "branches" b
    WHERE b."id" = "branch_hours"."branchId" AND b."restaurantId" = app_current_restaurant_id()
  ));

ALTER TABLE "menu_source_docs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_source_docs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "menu_source_docs"
  USING (EXISTS (
    SELECT 1 FROM "branches" b
    WHERE b."id" = "menu_source_docs"."branchId" AND b."restaurantId" = app_current_restaurant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "branches" b
    WHERE b."id" = "menu_source_docs"."branchId" AND b."restaurantId" = app_current_restaurant_id()
  ));

ALTER TABLE "menus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menus" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "menus"
  USING (EXISTS (
    SELECT 1 FROM "branches" b
    WHERE b."id" = "menus"."branchId" AND b."restaurantId" = app_current_restaurant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "branches" b
    WHERE b."id" = "menus"."branchId" AND b."restaurantId" = app_current_restaurant_id()
  ));

-- ─────────────────────────── menu sub-tree (restaurant via menu → branch) ───────────────────────────

ALTER TABLE "menu_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "menu_categories"
  USING (EXISTS (
    SELECT 1 FROM "menus" m JOIN "branches" b ON b."id" = m."branchId"
    WHERE m."id" = "menu_categories"."menuId" AND b."restaurantId" = app_current_restaurant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "menus" m JOIN "branches" b ON b."id" = m."branchId"
    WHERE m."id" = "menu_categories"."menuId" AND b."restaurantId" = app_current_restaurant_id()
  ));

ALTER TABLE "modifier_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modifier_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "modifier_groups"
  USING (EXISTS (
    SELECT 1 FROM "menus" m JOIN "branches" b ON b."id" = m."branchId"
    WHERE m."id" = "modifier_groups"."menuId" AND b."restaurantId" = app_current_restaurant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "menus" m JOIN "branches" b ON b."id" = m."branchId"
    WHERE m."id" = "modifier_groups"."menuId" AND b."restaurantId" = app_current_restaurant_id()
  ));

ALTER TABLE "menu_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "menu_items"
  USING (EXISTS (
    SELECT 1 FROM "menu_categories" c JOIN "menus" m ON m."id" = c."menuId"
      JOIN "branches" b ON b."id" = m."branchId"
    WHERE c."id" = "menu_items"."categoryId" AND b."restaurantId" = app_current_restaurant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "menu_categories" c JOIN "menus" m ON m."id" = c."menuId"
      JOIN "branches" b ON b."id" = m."branchId"
    WHERE c."id" = "menu_items"."categoryId" AND b."restaurantId" = app_current_restaurant_id()
  ));

ALTER TABLE "modifier_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modifier_options" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "modifier_options"
  USING (EXISTS (
    SELECT 1 FROM "modifier_groups" g JOIN "menus" m ON m."id" = g."menuId"
      JOIN "branches" b ON b."id" = m."branchId"
    WHERE g."id" = "modifier_options"."groupId" AND b."restaurantId" = app_current_restaurant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "modifier_groups" g JOIN "menus" m ON m."id" = g."menuId"
      JOIN "branches" b ON b."id" = m."branchId"
    WHERE g."id" = "modifier_options"."groupId" AND b."restaurantId" = app_current_restaurant_id()
  ));

ALTER TABLE "menu_item_modifier_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_item_modifier_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "menu_item_modifier_groups"
  USING (EXISTS (
    SELECT 1 FROM "menu_items" i JOIN "menu_categories" c ON c."id" = i."categoryId"
      JOIN "menus" m ON m."id" = c."menuId" JOIN "branches" b ON b."id" = m."branchId"
    WHERE i."id" = "menu_item_modifier_groups"."itemId" AND b."restaurantId" = app_current_restaurant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "menu_items" i JOIN "menu_categories" c ON c."id" = i."categoryId"
      JOIN "menus" m ON m."id" = c."menuId" JOIN "branches" b ON b."id" = m."branchId"
    WHERE i."id" = "menu_item_modifier_groups"."itemId" AND b."restaurantId" = app_current_restaurant_id()
  ));

-- ─────────────────────────── app role hardening (run ONCE as superuser) ───────────────────────────
-- FORCE RLS above already applies policies even to the table owner. The line below removes any
-- residual bypass so a future GRANT/role change can't silently disable isolation. It is idempotent.
-- Uncomment when applying against the dev cluster (role name = APP_USER in scripts/pg.mjs):
--   ALTER ROLE fd NOBYPASSRLS;
