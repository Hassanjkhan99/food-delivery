import { test as base, expect, type APIRequestContext } from "@playwright/test";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000/graphql";

/**
 * Extended test with a lightweight readiness probe. Smoke specs call
 * `ensureBackend()` up front so a missing stack yields a clear skip rather
 * than a wall of confusing selector timeouts.
 */
export const test = base.extend<{ ensureBackend: () => Promise<void> }>({
  ensureBackend: async ({ request }, use) => {
    await use(async () => {
      await assertApiReachable(request);
    });
  },
});

export async function assertApiReachable(request: APIRequestContext): Promise<void> {
  try {
    const res = await request.post(API_URL, {
      data: { query: "{ __typename }" },
      headers: { "content-type": "application/json" },
      timeout: 5_000,
    });
    if (!res.ok()) {
      test.skip(true, `API not ready at ${API_URL} (HTTP ${res.status()})`);
    }
  } catch {
    test.skip(true, `API unreachable at ${API_URL} — start the stack before running E2E.`);
  }
}

export { expect };
