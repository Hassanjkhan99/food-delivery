// Shared GraphQL error mapper for both Yoga instances (standalone server.ts and the
// collapsed Next.js route.ts). Yoga masks any non-GraphQLError throw into the generic
// "Unexpected error." — which hides Zod validation failures and Prisma errors from the
// client and makes field-level highlighting impossible (#145).
//
// This runs BEFORE the default masking: we translate the errors we understand into
// clean, client-safe GraphQLErrors (with a stable `code` and, for input errors, a
// `fieldErrors` array the UI can map to inputs), and delegate everything else to Yoga's
// default maskError so no internal detail (stack/SQL/Prisma text) ever leaks.
import { GraphQLError } from "graphql";
import { maskError as defaultMaskError } from "graphql-yoga";

export type FieldError = { path: string; message: string };

type ZodIssue = {
  path: Array<string | number>;
  message: string;
  code?: string;
  // Zod v3 exposes `type`, v4 exposes `origin`, for too_small/too_big.
  type?: string;
  origin?: string;
  received?: unknown;
};
type ZodLike = { name: string; issues: ZodIssue[] };
type PrismaKnownError = { code: string; meta?: Record<string, unknown> };

// Duck-typed so a second copy of zod/prisma in the tree can't defeat instanceof.
function isZodError(e: unknown): e is ZodLike {
  return (
    !!e &&
    typeof e === "object" &&
    (e as { name?: unknown }).name === "ZodError" &&
    Array.isArray((e as { issues?: unknown }).issues)
  );
}

function isPrismaKnownError(e: unknown): e is PrismaKnownError {
  return (
    !!e &&
    typeof e === "object" &&
    typeof (e as { code?: unknown }).code === "string" &&
    /^P\d{4}$/.test((e as { code: string }).code)
  );
}

// Friendly labels for otherwise-technical field names. Falls back to a humanized version
// of the last path segment (amountMinor -> "Amount", contactPhone -> "Contact phone").
const FIELD_LABELS: Record<string, string> = {
  number: "Card number",
  cvc: "CVC",
  expMonth: "Expiry month",
  expYear: "Expiry year",
  amountMinor: "Amount",
  paymentMethodId: "Payment method",
  branchId: "Restaurant",
  menuItemId: "Item",
  comboId: "Deal",
  deliveryLat: "Delivery location",
  deliveryLng: "Delivery location",
  contactPhone: "Phone number",
  phone: "Phone number",
  addressText: "Address",
  addressLabel: "Address label",
  code: "Code",
  voucherCode: "Voucher code",
  email: "Email",
  recipientEmail: "Recipient email",
  qty: "Quantity",
  lines: "Cart",
  tipAmount: "Tip",
  redeemPoints: "Points",
  contentType: "File type",
  scheduledFor: "Scheduled time",
};

function humanizeLabel(path: string): string {
  const seg = path.split(".").pop() ?? path;
  if (FIELD_LABELS[seg]) return FIELD_LABELS[seg];
  const words = seg
    .replace(/Minor$|Id$/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (!words) return "This field";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Zod's built-in messages are technical ("String must contain at least 13 character(s)").
// Detect them so we only rewrite defaults and never clobber an author's custom message.
function isDefaultZodMessage(msg: string): boolean {
  return /^(String|Number|Array) must (contain|be)|^Invalid input|^Invalid$|^Required$|^Expected |^Too (small|big)|must contain at (least|most)|greater than or equal|less than or equal|^Invalid email|Number must be a/i.test(
    msg,
  );
}

// Turn a raw Zod issue into friendly, customer-readable copy.
function friendlyZodMessage(issue: ZodIssue): string {
  const label = humanizeLabel(issue.path.map(String).join("."));
  const kind = issue.type ?? issue.origin; // "string" | "number" | "array" | ...
  switch (issue.code) {
    case "too_small":
      if (kind === "array") return "Please add at least one item.";
      if (kind === "number") return `Please enter a valid ${label.toLowerCase()}.`;
      return `${label} is too short.`;
    case "too_big":
      if (kind === "array") return `${label} has too many items.`;
      if (kind === "number") return `${label} is too high.`;
      return `${label} is too long.`;
    case "invalid_type":
      return issue.received === undefined || issue.received === null
        ? `${label} is required.`
        : `Please enter a valid ${label.toLowerCase()}.`;
    case "invalid_string":
    case "invalid_format":
      return `Please enter a valid ${label.toLowerCase()}.`;
    case "invalid_enum_value":
    case "invalid_value":
    case "invalid_union":
      return `Please choose a valid ${label.toLowerCase()}.`;
    default:
      return `Please check the ${label.toLowerCase()}.`;
  }
}

/** Yoga MaskError: (error, message) => Error. `error` is the envelop wrapper; the real
 *  thrown value is `error.originalError`. */
export const maskError = (error: unknown, message: string): Error => {
  const original = (error as { originalError?: unknown })?.originalError ?? error;

  if (isZodError(original)) {
    const fieldErrors: FieldError[] = original.issues.map((i) => ({
      path: i.path.map(String).join("."),
      // Rewrite Zod's technical defaults; keep any custom message a schema author set.
      message: isDefaultZodMessage(i.message) ? friendlyZodMessage(i) : i.message,
    }));
    const first = fieldErrors[0];
    const msg = first ? first.message : "Please check your input.";
    return new GraphQLError(msg, {
      extensions: { code: "BAD_USER_INPUT", fieldErrors },
    });
  }

  if (isPrismaKnownError(original)) {
    if (original.code === "P2025") {
      return new GraphQLError("The requested item was not found.", {
        extensions: { code: "not_found" },
      });
    }
    if (original.code === "P2002") {
      const target = original.meta?.target;
      const fields = Array.isArray(target) ? target.join(", ") : undefined;
      return new GraphQLError(
        fields ? `A record with this ${fields} already exists.` : "This already exists.",
        { extensions: { code: "conflict" } },
      );
    }
    // Other Prisma errors: fall through to default masking (never leak internals).
  }

  return defaultMaskError(error, message) as Error;
};
