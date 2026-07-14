import { test, expect } from "../src/fixtures.js";
import { loginAs } from "../src/auth.js";

/**
 * Admin smoke: the marketplace overview KPIs load and the approvals/refunds
 * surfaces are reachable. Read-only assertions — we don't mutate seed state.
 */
test.describe("admin UI", () => {
  test.beforeEach(async ({ ensureBackend }) => {
    await ensureBackend();
  });

  test("command center loads", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin");
    // #135 rebuilt /admin as the live-ops "Command center" (was "Marketplace overview").
    await expect(page.getByRole("heading", { name: /command center/i })).toBeVisible();
  });

  test("restaurants approvals page loads", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/restaurants");
    await expect(page.getByRole("heading", { name: /restaurants/i })).toBeVisible();
  });

  test("refunds page is reachable", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/refunds");
    await expect(page.locator("main")).not.toBeEmpty();
  });
});
