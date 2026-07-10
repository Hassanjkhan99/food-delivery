// Emoji glyph per platform cuisine (presentation only; the taxonomy lives in
// @fd/shared CUISINE_TAGS). Kept here because it's a web-layer styling concern.
import type { CuisineTag } from "@fd/shared";

export const CUISINE_EMOJI: Record<CuisineTag, string> = {
  Biryani: "🍚",
  "BBQ/Karahi": "🍢",
  Burgers: "🍔",
  Pizza: "🍕",
  Chinese: "🥡",
  Desi: "🍛",
  Healthy: "🥗",
  Desserts: "🍰",
  Drinks: "🥤",
};

export function cuisineEmoji(tag: string): string {
  return CUISINE_EMOJI[tag as CuisineTag] ?? "🍽️";
}
