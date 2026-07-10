/**
 * Browse-feed discovery: filter + sort vocabulary shared by the API resolver
 * (browseBranches) and the web filter sheet (#51). Keeping the enums/bucketing
 * here means the client and server agree on price bands and sort keys without
 * duplicating magic values.
 */

/** Sort keys for browseBranches. `relevance` is the default hybrid ranking. */
export const BROWSE_SORTS = ["relevance", "rating", "distance", "eta", "popularity"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];

export function isBrowseSort(value: string): value is BrowseSort {
  return (BROWSE_SORTS as readonly string[]).includes(value);
}

/**
 * Price band 1-3 ("Rs" / "Rs Rs" / "Rs Rs Rs"), Foodpanda-style. Derived from a
 * branch's median menu-item price so it can't be gamed by a single cheap/expensive
 * item. Thresholds are in minor units (paisa); tune as the catalogue matures.
 *
 * band 1: median <  Rs 500   (budget)
 * band 2: median <  Rs 1200  (mid)
 * band 3: median >= Rs 1200  (premium)
 */
export const PRICE_BAND_THRESHOLDS_MINOR = [50_000, 120_000] as const;

/** Bucket a median price (minor units) into a 1-3 price band. */
export function priceBandFor(medianMinor: number): 1 | 2 | 3 {
  if (medianMinor < PRICE_BAND_THRESHOLDS_MINOR[0]) return 1;
  if (medianMinor < PRICE_BAND_THRESHOLDS_MINOR[1]) return 2;
  return 3;
}

/** Median of a numeric list (0 for an empty list). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return sorted[mid] ?? 0;
}

/** Human "Rs" glyph string for a price band (1-3). */
export function priceBandLabel(band: number): string {
  return "Rs".repeat(Math.min(Math.max(Math.round(band), 1), 3));
}
