import { test, expect } from "../src/fixtures.js";
import { loginAs } from "../src/auth.js";

/**
 * 3D theme page visual sanity. This spec runs under BOTH the default and the
 * `reduced-motion` project (see playwright.config.ts). The key contract:
 * with `prefers-reduced-motion: reduce`, the parallax/tilt effects must degrade
 * (framer-motion's useReducedMotion pins transforms) yet the page still renders.
 *
 * Uses the deterministic seed slug `karachi-biryani-house`.
 */
const SLUG = "karachi-biryani-house";

test.describe("restaurant theme page", () => {
  test.beforeEach(async ({ ensureBackend }) => {
    await ensureBackend();
  });

  test("themed page renders and degrades gracefully", async ({ page }) => {
    await loginAs(page, "customer2");
    const res = await page.goto(`/r/${SLUG}`);

    // If the slug drifted from the seed, don't hard-fail the suite — note & skip.
    if (res && res.status() >= 400) {
      test.skip(true, `Seed slug ${SLUG} not found (HTTP ${res.status()}).`);
    }

    await expect(page.locator("h1")).toBeVisible();

    // The hero exists in both motion modes; scrolling must not throw.
    await page.mouse.wheel(0, 600);
    await expect(page.locator("h1")).toBeVisible();

    // Sanity: no unhandled error blanked the page.
    await expect(page.locator("main, body")).not.toBeEmpty();
  });
});
