// Theme plumbing shared by the customer restaurant page and the branding editor preview.
export type ThemeShape = {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontKey: string;
  cardStyle: string;
  heroEffect: string;
  logoUrl?: string | null;
  heroUrl?: string | null;
};

export const DEFAULT_THEME: ThemeShape = {
  primaryColor: "#171717",
  accentColor: "#f59e0b",
  backgroundColor: "#fafafa",
  textColor: "#171717",
  fontKey: "sans",
  cardStyle: "flat",
  heroEffect: "none",
};

export const FONT_STACKS: Record<string, string> = {
  sans: "var(--font-geist-sans), ui-sans-serif, system-ui",
  serif: "Georgia, 'Times New Roman', serif",
  display: "'Trebuchet MS', 'Segoe UI', ui-sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, monospace",
  rounded: "'Comic Sans MS', 'Segoe UI', ui-rounded, system-ui",
  elegant: "'Palatino Linotype', 'Book Antiqua', serif",
};

/** CSS custom properties scoped to the restaurant page container. */
export function themeVars(theme: ThemeShape): React.CSSProperties {
  return {
    "--brand-primary": theme.primaryColor,
    "--brand-accent": theme.accentColor,
    "--brand-bg": theme.backgroundColor,
    "--brand-text": theme.textColor,
    fontFamily: FONT_STACKS[theme.fontKey] ?? FONT_STACKS.sans,
    backgroundColor: "var(--brand-bg)",
    color: "var(--brand-text)",
  } as React.CSSProperties;
}

/** Card classes per style; tilt3d additionally wraps in <TiltCard enabled>. */
export function cardClasses(cardStyle: string): string {
  switch (cardStyle) {
    case "glass":
      // Glass is an intentional decorative treatment. Uses the shared liquid-glass
      // recipe (kd-glass-sheet: translucent fill + blur/saturate + light border and
      // an inset specular highlight) so a glass-themed menu matches the customer feed.
      return "kd-glass-sheet shadow-sm";
    case "tilt3d":
      return "border border-kd-border bg-kd-surface shadow-md";
    default:
      // Solid surface + subtle shadow reads far more premium than the old flat
      // translucent card (was `border bg-white/80`).
      return "border border-kd-border bg-kd-surface shadow-sm";
  }
}
