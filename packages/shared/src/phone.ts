// Single source of truth for Pakistani mobile-number handling, shared by the login OTP
// schema, the checkout contactPhone schema, and the web forms (#148). The canonical
// stored format is `+92` followed by exactly 10 digits (13 chars total); normalization
// happens at the edges (input + schema), never in the DB.
import { z } from "zod";

// Friendly, example-led copy — replaces the old format-leaking
// "Phone must be in +92XXXXXXXXXX format". Never surface the raw pattern to users.
export const PK_PHONE_MESSAGE = "Please enter a valid Pakistani mobile number, e.g. 0310 2658153.";

// A PK mobile number is +92 followed by 10 significant digits that always start with 3
// (local 03xx / international +923xx). Landlines and other non-mobile numbers are rejected.
const CANONICAL = /^\+923\d{9}$/;

/**
 * Normalize a user-entered Pakistani mobile number to canonical `+92XXXXXXXXXX`.
 *
 * Accepts common local forms and forgives spaces/dashes/parens:
 *   - `03102658153`      (11-digit local, leading 0)   → `+923102658153`
 *   - `3102658153`       (10-digit, no leading 0)      → `+923102658153`
 *   - `0310 265 8153`    (spaces)                      → `+923102658153`
 *   - `+92 310 2658153`  (spaces, already +92)         → `+923102658153`
 *   - `+92 0310 2658153` (trunk 0 left after +92)      → `+923102658153`
 *   - `0092310...` / `92310...` (country code, no +)   → `+923102658153`
 *   - already-canonical `+923102658153`                → unchanged
 *
 * Only mobile numbers are accepted: the 10 significant digits must start with 3.
 *
 * Returns the canonical string, or `null` if the input can't be a valid PK mobile number.
 */
export function normalizePkPhone(input: string): string | null {
  if (typeof input !== "string") return null;
  // Strip everything except digits and a single leading '+'.
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");

  // Drop an international access prefix (00) so `0092...` behaves like `+92...`.
  if (!hasPlus && digits.startsWith("00")) digits = digits.slice(2);

  let national: string;
  if (digits.startsWith("92")) {
    // Country code present (with or without the leading +).
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    // Local 11-digit form: leading 0 stands in for the country code.
    national = digits.slice(1);
  } else {
    // Bare national number, no leading 0 and no country code.
    national = digits;
  }

  // Forgive a trunk `0` left after the country code, e.g. `+92 0310 2658153` (easy to
  // type by keeping the field's prefilled `+92` and pasting the local example).
  if (national.startsWith("0")) national = national.slice(1);

  const canonical = `+92${national}`;
  return CANONICAL.test(canonical) ? canonical : null;
}

// Zod schema that normalizes on parse: `.parse("03102658153")` returns "+923102658153".
// Use this everywhere a PK phone is validated so the login OTP and checkout paths agree
// on one rule and store the canonical form.
export const pkPhoneSchema = z
  .string()
  .transform((v) => normalizePkPhone(v))
  .refine((v): v is string => v !== null, { message: PK_PHONE_MESSAGE });
