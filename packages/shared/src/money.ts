/** All money is integer minor units (paisa). Rs 1 = 100 minor units. */
export type Minor = number;

export function formatRs(minor: Minor): string {
  const rupees = minor / 100;
  return `Rs ${rupees.toLocaleString("en-PK", {
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Basis points helper: bps(850) applied to 10_000 minor = 850 minor. Rounds half up. */
export function applyBps(amountMinor: Minor, bps: number): Minor {
  return Math.round((amountMinor * bps) / 10_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical tax/price contract (#146). The SERVER is the single source of truth for
// all tax math; clients must never re-derive tax from a bare rate. Every price-bearing
// surface (menu, cart quote, order, receipt, refund) uses these helpers so inclusive and
// exclusive display can never diverge from the payable total.
// ─────────────────────────────────────────────────────────────────────────────

/** How menu prices are entered/displayed for a restaurant's tax profile. */
export type PriceDisplayMode = "inclusive" | "exclusive";

/**
 * Who is legally responsible for charging/remitting the tax. Default marketplace model is
 * `restaurant`; `platform_collecting_agent` only where a jurisdiction makes the platform a
 * collecting/withholding agent. Drives receipt wording — never label tax as an unexplained
 * platform charge.
 */
export type TaxResponsibility = "restaurant" | "platform_collecting_agent";

/**
 * Immutable per-line / per-order money breakdown. `finalMinor` is always the customer-payable
 * food amount for the unit of allocation; `finalMinor === baseMinor + taxMinor` exactly (no
 * lost minor unit), regardless of inclusive/exclusive mode.
 */
export type TaxBreakdown = {
  baseMinor: Minor; // pre-tax taxable amount
  taxMinor: Minor; // tax component
  finalMinor: Minor; // base + tax (tax-inclusive payable amount)
};

// Guardrails so a restaurant can't configure arbitrary labels or unsupported rates (#146
// acceptance: "Restaurant cannot configure arbitrary tax labels or unsupported rates").
// Jurisdiction-specific legal terms only — never a generic universal "VAT" default.
export const ALLOWED_TAX_LABELS = ["Sales tax", "GST", "Service tax", "VAT", "FED"] as const;
export type TaxLabel = (typeof ALLOWED_TAX_LABELS)[number];
/** Hard ceiling on a configurable rate (25%). A stored rate above this is rejected. */
export const MAX_TAX_RATE_BPS = 2500;

export function isAllowedTaxLabel(label: string): label is TaxLabel {
  return (ALLOWED_TAX_LABELS as readonly string[]).includes(label);
}

/**
 * Split a single amount into pre-tax base + tax.
 *
 * - `inclusive`: `amountMinor` already contains tax (the menu price the customer compares
 *   on). base = round(amount * 10000 / (10000 + rateBps)); tax = amount − base.
 * - exclusive: `amountMinor` is the pre-tax base; tax = applyBps(amount, rateBps).
 *
 * rateBps ≤ 0 → zero tax. Deterministic: `finalMinor === baseMinor + taxMinor` always, so a
 * receipt built from this never drifts by a minor unit.
 */
export function splitTax(amountMinor: Minor, rateBps: number, inclusive: boolean): TaxBreakdown {
  const amount = Math.max(0, Math.round(amountMinor));
  if (rateBps <= 0 || amount === 0) {
    return { baseMinor: amount, taxMinor: 0, finalMinor: amount };
  }
  if (inclusive) {
    const baseMinor = Math.round((amount * 10_000) / (10_000 + rateBps));
    return { baseMinor, taxMinor: amount - baseMinor, finalMinor: amount };
  }
  const taxMinor = applyBps(amount, rateBps);
  return { baseMinor: amount, taxMinor, finalMinor: amount + taxMinor };
}

/**
 * Customer-facing DISPLAY price for a single menu price under a chosen display mode (#146).
 * The stored menu price is inclusive or exclusive per the branch's tax profile; this returns
 * the amount to show — the tax-inclusive final in "inclusive" mode, the pre-tax base in
 * "exclusive" mode. Presentation only: it must never change the amount actually charged.
 */
export function displayPriceMinor(
  menuPriceMinor: Minor,
  rateBps: number,
  storedInclusive: boolean,
  mode: PriceDisplayMode,
): Minor {
  const b = splitTax(menuPriceMinor, rateBps, storedInclusive);
  return mode === "inclusive" ? b.finalMinor : b.baseMinor;
}

/**
 * Allocate tax across lines so the per-line tax snapshots sum EXACTLY to the tax computed on
 * the order total (deterministic largest-remainder; ties broken by line order). This is the
 * "rounding difference of one minor unit: deterministic allocation and receipt consistency"
 * edge case — computing each line independently would let Σ line-tax ≠ order-tax.
 *
 * Each `lineAmountsMinor[i]` is that line's customer-facing food amount in the SAME sense as
 * `splitTax`'s input (gross when inclusive, pre-tax when exclusive).
 */
export function allocateLineTax(
  lineAmountsMinor: Minor[],
  rateBps: number,
  inclusive: boolean,
): TaxBreakdown[] {
  const amounts = lineAmountsMinor.map((a) => Math.max(0, Math.round(a)));
  const total = amounts.reduce((s, a) => s + a, 0);
  const order = splitTax(total, rateBps, inclusive);
  if (amounts.length === 0) return [];
  if (order.taxMinor === 0 || total === 0) {
    // No tax to spread: base/final follow the amount directly per mode.
    return amounts.map((a) => ({ baseMinor: a, taxMinor: 0, finalMinor: a }));
  }

  // Ideal (fractional) tax share per line, then largest-remainder rounding to hit order.taxMinor.
  const ideal = amounts.map((a) => (order.taxMinor * a) / total);
  const taxByLine = ideal.map((x) => Math.floor(x));
  const distributed = taxByLine.reduce((s, f) => s + f, 0);
  const remainder = order.taxMinor - distributed; // ≥ 0, < amounts.length
  const byFrac = ideal
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remainder; k++) {
    const target = byFrac[k % byFrac.length];
    if (target) taxByLine[target.i] = (taxByLine[target.i] ?? 0) + 1;
  }

  return amounts.map((a, i) => {
    const taxMinor = taxByLine[i] ?? 0;
    // Inclusive: the line gross is fixed (= a); base follows. Exclusive: base fixed (= a).
    return inclusive
      ? { baseMinor: a - taxMinor, taxMinor, finalMinor: a }
      : { baseMinor: a, taxMinor, finalMinor: a + taxMinor };
  });
}
