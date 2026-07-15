/**
 * Curated dietary / allergen tag taxonomy for menu items (customer list-view
 * redesign). Like CUISINE_TAGS this is a fixed set in code, not free-tagging:
 * MenuItem.dietaryTags is an unconstrained String[], so growing the list is a
 * code change here, not a DB migration. Values are persisted verbatim — keep stable.
 *
 * `icon` is a small glyph for the item-row chip; `label` is the display text.
 */
export const DIETARY_TAGS = [
  { key: "halal", label: "Halal", icon: "☪️" },
  { key: "vegetarian", label: "Vegetarian", icon: "🌱" },
  { key: "vegan", label: "Vegan", icon: "🌿" },
  { key: "gluten_free", label: "Gluten-free", icon: "🌾" },
  { key: "spicy", label: "Spicy", icon: "🌶️" },
  { key: "contains_nuts", label: "Contains nuts", icon: "🥜" },
] as const;

export type DietaryTagKey = (typeof DIETARY_TAGS)[number]["key"];

const DIETARY_BY_KEY = new Map(DIETARY_TAGS.map((t) => [t.key, t]));

/** Resolve a stored dietary key to its display {label, icon}, or null if unknown
 *  (so a stale/removed key never crashes the row — it just isn't rendered). */
export function dietaryTag(key: string): { key: string; label: string; icon: string } | null {
  return DIETARY_BY_KEY.get(key as DietaryTagKey) ?? null;
}
