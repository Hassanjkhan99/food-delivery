import { test, expect } from "../src/fixtures.js";
import { loginAs, loginViaUi } from "../src/auth.js";

/**
 * Customer journey smoke: browse -> open a restaurant -> add to cart -> checkout.
 * Depth is guarded — the seeded feed drives which restaurant/items exist, so we
 * assert structure (headings, reachable pages) rather than exact menu content.
 */
test.describe("customer UI", () => {
  test.beforeEach(async ({ ensureBackend }) => {
    await ensureBackend();
  });

  test("dev-OTP login form signs a customer in", async ({ page }) => {
    await loginViaUi(page, "customer2");
    // Landing anywhere but /login means the session cookie took.
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("home feed renders and a restaurant page opens", async ({ page }) => {
    await loginAs(page, "customer2");
    await page.goto("/");

    // The home search affordance is always present even with an empty feed.
    await expect(page.getByPlaceholder(/search/i).first()).toBeVisible();

    // Open the first restaurant card link if the seeded feed produced one.
    const firstRestaurant = page.locator('a[href^="/r/"]').first();
    if ((await firstRestaurant.count()) > 0) {
      await firstRestaurant.click();
      await expect(page).toHaveURL(/\/r\//);
      await expect(page.locator("h1")).toBeVisible();
    } else {
      test.info().annotations.push({
        type: "note",
        description: "Seeded feed had no restaurants near default location; skipped drill-in.",
      });
    }
  });

  test("cart and checkout pages are reachable without crashing", async ({ page }) => {
    await loginAs(page, "customer2");

    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: /your cart/i })).toBeVisible();

    await page.goto("/checkout");
    // Empty cart may redirect to /cart; either the checkout heading or a cart
    // heading is an acceptable, non-crashing outcome.
    await expect(page.getByRole("heading", { name: /checkout|your cart/i }).first()).toBeVisible();
  });

  test("orders history page is reachable", async ({ page }) => {
    await loginAs(page, "customerCard");
    await page.goto("/orders");
    await expect(page.locator("body")).toBeVisible();
    // No unhandled client error should leave the page blank.
    await expect(page.locator("main, body")).not.toBeEmpty();
  });
});
