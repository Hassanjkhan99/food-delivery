// WCAG contrast helpers (#49, a11y). Used by the restaurant theme editor to warn
// owners when their chosen text/background colors fall below the AA threshold, so
// customer-facing storefronts stay readable. Pure functions, no deps.

/** WCAG 2.1 AA minimum contrast ratio for normal-size body text. */
export const WCAG_AA_NORMAL = 4.5;
/** WCAG 2.1 AA minimum for large text (>=18.66px bold or >=24px). */
export const WCAG_AA_LARGE = 3;

/** Parse a #rgb or #rrggbb hex string to [r,g,b] in 0..255. Returns null if unparseable. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, "");
  if (m.length === 3) {
    const r = parseInt(m[0]! + m[0]!, 16);
    const g = parseInt(m[1]! + m[1]!, 16);
    const b = parseInt(m[2]! + m[2]!, 16);
    return [r, g, b];
  }
  if (m.length === 6) {
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  return null;
}

/** Relative luminance per WCAG 2.1 (sRGB). Input channels are 0..255. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Contrast ratio (1..21) between two hex colors. Returns null if either color
 * cannot be parsed, so callers can skip the check rather than warn spuriously.
 */
export function contrastRatio(fgHex: string, bgHex: string): number | null {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  if (!fg || !bg) return null;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
