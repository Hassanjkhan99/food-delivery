import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Pill / chip styling. Consolidates the ~90 ad-hoc `rounded-full` pills across the app.
 *
 * `Chip` renders a `<span>` (display chips: cuisine tags, counts, labels). For an
 * interactive filter chip, apply `chipVariants({...})` to your own `<button>` so it keeps
 * native button semantics + `aria-pressed` — mirrors how `buttonVariants`/`badgeVariants`
 * are exported for reuse.
 */
const chipVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      size: {
        sm: "px-2.5 py-1 text-xs",
        default: "px-3 py-1.5 text-sm",
      },
      tone: {
        // Neutral outlined pill on a solid surface (the common filter/tag chip).
        neutral: "border border-kd-border bg-kd-surface text-kd-fg-muted",
        // Brand-tinted pill.
        primary: "border border-transparent bg-kd-primary-soft text-kd-primary",
        // Frosted on-media chip (white text over imagery). See ui/THEME.md → Liquid Glass.
        glass: "kd-glass text-white",
      },
      interactive: { true: "cursor-pointer", false: "" },
      selected: { true: "", false: "" },
    },
    compoundVariants: [
      { tone: "neutral", interactive: true, class: "hover:border-kd-fg-subtle" },
      {
        tone: "neutral",
        selected: true,
        class: "border-kd-primary bg-kd-primary-soft text-kd-primary",
      },
      { tone: "primary", selected: true, class: "bg-kd-primary text-white" },
    ],
    defaultVariants: { size: "default", tone: "neutral", interactive: false, selected: false },
  },
);

function Chip({
  className,
  size,
  tone,
  selected,
  interactive,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof chipVariants>) {
  return (
    <span
      data-slot="chip"
      className={cn(chipVariants({ size, tone, selected, interactive }), className)}
      {...props}
    />
  );
}

export { Chip, chipVariants };
