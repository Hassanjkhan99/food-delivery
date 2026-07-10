import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { SEED_USERS, type SeedUserKey } from "./seed-world.js";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000/graphql";

const REQUEST_OTP = /* GraphQL */ `
  mutation E2eRequestOtp($phone: String!) {
    requestOtp(phone: $phone) {
      devCode
    }
  }
`;
const VERIFY_OTP = /* GraphQL */ `
  mutation E2eVerifyOtp($phone: String!, $code: String!) {
    verifyOtp(phone: $phone, code: $code) {
      home
      roles {
        role
      }
    }
  }
`;

type GqlResult<T> = { data?: T; errors?: Array<{ message: string }> };

async function gql<T>(
  request: APIRequestContext,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await request.post(API_URL, {
    data: { query, variables },
    headers: { "content-type": "application/json" },
  });
  expect(res.ok(), `GraphQL HTTP ${res.status()} for ${API_URL}`).toBeTruthy();
  const body = (await res.json()) as GqlResult<T>;
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("GraphQL response had no data");
  return body.data;
}

/**
 * Dev-OTP login via the API (no SMS): requestOtp returns `devCode` outside
 * production, which we immediately feed to verifyOtp. The session cookie is
 * host-only for `localhost`, so it applies to both :3000 (web) and :4000 (api).
 *
 * Uses `page.request`, which shares the browser context's cookie jar, so after
 * this call the authenticated cookie is present for subsequent page navigations.
 * Returns the viewer's default `home` path.
 */
export async function loginAs(page: Page, user: SeedUserKey): Promise<string> {
  const { phone } = SEED_USERS[user];
  const req = page.request;

  const requested = await gql<{ requestOtp: { devCode: string | null } }>(req, REQUEST_OTP, {
    phone,
  });
  const code = requested.requestOtp.devCode;
  if (!code) {
    throw new Error(
      "requestOtp returned no devCode — the API must run outside production (NODE_ENV!=production).",
    );
  }

  const verified = await gql<{ verifyOtp: { home: string } }>(req, VERIFY_OTP, { phone, code });
  return verified.verifyOtp.home;
}

/**
 * UI-driven login: exercises the real /login form and dev-code banner. Slower
 * than {@link loginAs} but validates the front-end auth flow end-to-end.
 */
export async function loginViaUi(page: Page, user: SeedUserKey): Promise<void> {
  const { phone } = SEED_USERS[user];
  await page.goto("/login");
  await page.getByPlaceholder("+923001234567").fill(phone);
  await page.getByRole("button", { name: /send code/i }).click();

  // Dev banner: "Dev mode — your code is 123456"
  const banner = page.getByText(/your code is/i);
  await expect(banner).toBeVisible();
  const text = (await banner.textContent()) ?? "";
  const code = text.replace(/\D/g, "").slice(-6);
  expect(code, "could not read dev OTP code from banner").toHaveLength(6);

  await page.getByRole("textbox", { name: /6-digit code/i }).fill(code);
  await page.getByRole("button", { name: /verify & sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
