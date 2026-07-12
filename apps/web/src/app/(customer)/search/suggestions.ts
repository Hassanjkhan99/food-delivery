// Client-side search assist (#37): typeahead predictions + spell-correction, so a
// partial or mistyped term ("biry", "biriani") guides the user instead of dead-ending
// on the server's literal `contains` match. A curated dictionary of common cravings —
// cuisine tags plus frequent dish keywords (seed aliases). A real system would derive
// this from menu data server-side (noted as a follow-up on #37).
import { CUISINE_TAGS } from "@fd/shared";

const DISH_KEYWORDS = [
  "Zinger",
  "Burger",
  "Biryani",
  "Pizza",
  "Karahi",
  "Nihari",
  "Roll",
  "Shawarma",
  "Paratha",
  "Kebab",
  "Tikka",
  "Fries",
  "Ice cream",
  "Cake",
  "Coffee",
  "Chai",
  "Pulao",
  "Haleem",
  "Chow mein",
  "Wings",
  "Sandwich",
  "Wrap",
  "Steak",
];

/** Deduped pool of terms used for typeahead + spell-correction. */
export const SEARCH_DICTIONARY: string[] = Array.from(
  new Set<string>([...CUISINE_TAGS, ...DISH_KEYWORDS]),
);

/** Lowercase, strip diacritics and punctuation — so "Café/BBQ" ≈ "cafe bbq". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Classic Levenshtein edit distance. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** 0..1 similarity between two raw strings (1 = identical). Substring hits rank high. */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (nb.startsWith(na) || na.startsWith(nb)) return 0.92;
  if (nb.includes(na) || na.includes(nb)) return 0.82;
  const d = levenshtein(na, nb);
  return 1 - d / Math.max(na.length, nb.length);
}

/**
 * Typeahead predictions for a partial query — dictionary terms that start with,
 * contain, or fuzzily resemble the input, best first. Excludes an exact match
 * (nothing to predict once the user has typed the whole word).
 */
export function suggestTerms(query: string, limit = 6): string[] {
  const q = normalize(query);
  if (q.length < 1) return [];
  return SEARCH_DICTIONARY.map((term) => ({ term, score: similarity(query, term) }))
    .filter((x) => x.score >= 0.34 && normalize(x.term) !== q)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.term);
}

/**
 * Spell-correction suggestions for a query that returned nothing — close dictionary
 * terms (typo tolerance) that are NOT just a substring of the query. Empty if the
 * query is already a good match or nothing is close enough.
 */
export function didYouMean(query: string, limit = 3): string[] {
  const q = normalize(query);
  if (q.length < 3) return [];
  return SEARCH_DICTIONARY.map((term) => ({ term, score: similarity(query, term) }))
    .filter((x) => x.score >= 0.5 && x.score < 1 && normalize(x.term) !== q)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.term);
}
