import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Liquid-glass primitives. The frosted material only reads when there's something
 * colorful behind it, so glass surfaces are almost always paired with
 * `<AmbientBackground />` (or placed over imagery). See ui/THEME.md → Liquid Glass.
 */

/**
 * Soft, blurred color blobs painted behind page content — the backdrop the glass
 * refracts. Absolutely fills its nearest positioned ancestor, so wrap the content
 * you want it behind in a `relative` container. Purely decorative.
 */
function AmbientBackground({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
      {...props}
    >
      <div className="absolute -left-24 -top-32 h-80 w-80 rounded-full bg-kd-primary opacity-20 blur-3xl" />
      <div className="absolute -right-20 -top-16 h-72 w-72 rounded-full bg-kd-accent opacity-20 blur-3xl" />
      <div className="absolute left-1/3 top-64 h-72 w-72 rounded-full bg-kd-success opacity-10 blur-3xl" />
    </div>
  );
}

const glassPanelVariants = cva("rounded-2xl", {
  variants: {
    variant: {
      // Standard frosted sheet — the default panel.
      default: "kd-glass-sheet",
      // Legibility-first (denser fill) — for text-heavy panels / state blocks.
      strong: "kd-glass-solid",
    },
  },
  defaultVariants: { variant: "default" },
});

/**
 * A frosted glass panel that sits on the page background (theme-aware: flips to
 * warm charcoal in dark mode). Use for state blocks, reward/rail cards, sheets.
 */
function GlassPanel({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof glassPanelVariants>) {
  return (
    <div
      data-slot="glass-panel"
      className={cn(glassPanelVariants({ variant }), className)}
      {...props}
    />
  );
}

/**
 * A small frosted pill designed to float over imagery/gradients (promo, deal,
 * rating chips). White text/icons are expected — the badge sits on a media scrim.
 */
function GlassBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="glass-badge"
      className={cn(
        "kd-glass-badge inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold leading-none text-white",
        className,
      )}
      {...props}
    />
  );
}

export { AmbientBackground, GlassPanel, GlassBadge, glassPanelVariants };
