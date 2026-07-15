// Typography fallback (tier 3 of the image pipeline, #50): deterministic initials
// + a color gradient derived from the name, so every image slot has a stable,
// on-brand look even with zero photos. Same name -> same colors across renders.

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function seedHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** Gradient for a fallback tile. Uses the restaurant's brand tint when given,
 * otherwise a stable hue hashed from the name. When a distinct accent is also given
 * (brand-through-glass, customer list-view redesign) it becomes the second stop so the
 * tier-3 hero reads as the restaurant's own brand gradient, not a generic dark fade. */
export function fallbackGradient(
  seed: string,
  tint?: string | null,
  accent?: string | null,
): string {
  if (tint && accent && accent !== tint) {
    return `linear-gradient(140deg, ${tint} 0%, color-mix(in srgb, ${tint} 60%, ${accent}) 60%, ${accent} 100%)`;
  }
  if (tint) return `linear-gradient(135deg, ${tint}, color-mix(in srgb, ${tint} 55%, #000))`;
  const h = seedHue(seed);
  return `linear-gradient(135deg, hsl(${h} 62% 58%), hsl(${(h + 40) % 360} 60% 42%))`;
}
