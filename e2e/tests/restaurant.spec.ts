import { test, expect } from "../src/fixtures.js";
import { loginAs } from "../src/auth.js";

/**
 * Restaurant-owner smoke: the live order board loads and the menu manager's
 * draft -> publish affordance is present. We assert the controls exist rather
 * than mutating live seed state destructively.
 */
test.describe("restaurant UI", () => {
  test.beforeEach(async ({ ensureBackend }) => {
    await ensureBackend();
  });

  test("live order board loads for the owner", async ({ page }) => {
    await loginAs(page, "ownerKarachiBiryani");
    await page.goto("/restaurant/orders");
    await expect(page.getByRole("heading", { name: /live board/i })).toBeVisible();
  });

  test("menu manager exposes the publish control", async ({ page }) => {
    await loginAs(page, "ownerKarachiBiryani");
    await page.goto("/restaurant/menu");
    await expect(page.getByRole("heading", { name: /menu manager/i })).toBeVisible();
    // Draft -> publish is the core visibility flip; the button should render.
    await expect(page.getByRole("button", { name: /publish/i }).first()).toBeVisible();
  });

  test("restaurant dashboard is reachable", async ({ page }) => {
    await loginAs(page, "ownerKarachiBiryani");
    await page.goto("/restaurant");
    await expect(page.locator("main")).not.toBeEmpty();
  });
});
