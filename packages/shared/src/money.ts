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
