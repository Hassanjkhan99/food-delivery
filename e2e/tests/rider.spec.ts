import { test, expect } from "../src/fixtures.js";
import { loginAs } from "../src/auth.js";

/**
 * Rider smoke: the rider hub loads and the online/offline availability toggle
 * is present (the entry point for the pickup -> deliver flow).
 */
test.describe("rider UI", () => {
  test.beforeEach(async ({ ensureBackend }) => {
    await ensureBackend();
  });

  test("rider hub shows the availability toggle", async ({ page }) => {
    await loginAs(page, "riderIndependent");
    await page.goto("/rider");
    // Button text is "Go online" or "Go offline" depending on current state.
    await expect(page.getByRole("button", { name: /go (online|offline)/i })).toBeVisible();
  });

  test("rider offers/active-jobs sections render", async ({ page }) => {
    await loginAs(page, "riderIndependent");
    await page.goto("/rider");
    // At least one of the two board sections must be present.
    await expect(
      page.getByRole("heading", { name: /new offers|active jobs/i }).first(),
    ).toBeVisible();
  });
});
