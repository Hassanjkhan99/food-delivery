// Reads structured backend errors (#145) off a urql CombinedError. The API maps Zod
// validation failures to `code: "BAD_USER_INPUT"` with an `extensions.fieldErrors`
// array ([{ path, message }]) and business rules to stable `extensions.code` strings.
// This turns that into something forms can use for messages and per-field highlighting.

export type FieldError = { path: string; message: string };

export type ParsedGqlError = {
  /** Human-readable message for the primary error (first GraphQL error). */
  message: string;
  /** Stable machine code, e.g. "BAD_USER_INPUT", "not_found", "branch_closed". */
  code?: string;
  /** Per-field validation messages keyed by field path (e.g. "amountMinor", "lines.0.qty"). */
  fieldErrors: Record<string, string>;
};

type GqlErrorLike = {
  message: string;
  extensions?: {
    code?: string;
    fieldErrors?: FieldError[];
  } | null;
};

type CombinedErrorLike =
  | {
      graphQLErrors?: GqlErrorLike[];
      networkError?: Error | null;
      message?: string;
    }
  | null
  | undefined;

/**
 * Normalize a urql error into `{ message, code, fieldErrors }`.
 * `fallback` is used when there's no GraphQL error (e.g. a network failure).
 */
export function parseGqlError(
  error: CombinedErrorLike,
  fallback = "Something went wrong. Please try again.",
): ParsedGqlError {
  if (!error) return { message: fallback, fieldErrors: {} };

  const gql = error.graphQLErrors?.[0];
  if (!gql) {
    // Network error or non-GraphQL failure.
    return { message: error.networkError?.message || error.message || fallback, fieldErrors: {} };
  }

  const fieldErrors: Record<string, string> = {};
  for (const fe of gql.extensions?.fieldErrors ?? []) {
    // First message per path wins; keep the raw path as the key.
    if (fe.path && !(fe.path in fieldErrors)) fieldErrors[fe.path] = fe.message;
  }

  return {
    message: gql.message || fallback,
    code: gql.extensions?.code,
    fieldErrors,
  };
}

/** Message for a specific field path, if the backend flagged it. */
export function fieldError(
  parsed: ParsedGqlError | null | undefined,
  path: string,
): string | undefined {
  return parsed?.fieldErrors?.[path];
}

// Customer-facing copy for known backend error codes (#145). When a code is present we
// prefer this friendlier phrasing; otherwise we fall back to the server's own message.
const ERROR_COPY: Record<string, string> = {
  branch_not_found:
    "This restaurant is no longer available, so we cleared your cart. Please choose a restaurant again.",
  restaurant_pending: "This restaurant isn't open for orders yet.",
  restaurant_suspended: "This restaurant is temporarily unavailable.",
  restaurant_unavailable: "This restaurant isn't available right now.",
  not_accepting_orders: "This restaurant isn't accepting orders right now.",
  no_published_menu: "This restaurant hasn't published its menu yet.",
  branch_closed: "This restaurant is currently closed.",
};

// Codes meaning the cart's restaurant can no longer be ordered from → the cart is stale
// and should be reset so the customer isn't stuck on a dead checkout.
const STALE_CART_CODES = new Set([
  "branch_not_found",
  "no_published_menu",
  "restaurant_pending",
  "restaurant_suspended",
  "restaurant_unavailable",
]);

/** Friendly customer-facing message for a parsed error (falls back to the server message). */
export function friendlyMessage(parsed: ParsedGqlError | null | undefined): string {
  if (!parsed) return "Something went wrong. Please try again.";
  return (parsed.code && ERROR_COPY[parsed.code]) || parsed.message;
}

/** True when the error means the cart's restaurant is gone/unorderable and should be reset. */
export function isStaleCartError(parsed: ParsedGqlError | null | undefined): boolean {
  return !!parsed?.code && STALE_CART_CODES.has(parsed.code);
}
