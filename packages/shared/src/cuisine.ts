/**
 * Curated platform cuisine taxonomy (fixed list, not free-tagging — see the
 * ux-parity-decisions memory / issue #36). Restaurants pick from this set;
 * the home cuisine rail is rendered from it and filters the feed.
 *
 * Growing the list is a code change here, not a DB migration (Restaurant.cuisineTags
 * is an unconstrained String[]). Keep values stable — they are persisted verbatim.
 */
export const CUISINE_TAGS = [
  "Biryani",
  "BBQ/Karahi",
  "Burgers",
  "Pizza",
  "Chinese",
  "Desi",
  "Healthy",
  "Desserts",
  "Drinks",
] as const;

export type CuisineTag = (typeof CUISINE_TAGS)[number];

export function isCuisineTag(value: string): value is CuisineTag {
  return (CUISINE_TAGS as readonly string[]).includes(value);
}
