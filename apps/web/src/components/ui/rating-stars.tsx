"use client";

import * as React from "react";
import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Star rating — display or interactive. Consolidates the ~9 ad-hoc `Star`-fill loops.
 * Omit `onChange` for a read-only display (renders as an `img` with an aria-label);
 * pass `onChange` to make it a clickable input. Optional `count` shows "(N)".
 */
function RatingStars({
  value,
  count,
  max = 5,
  size = "default",
  onChange,
  className,
}: {
  value: number;
  count?: number;
  max?: number;
  size?: "sm" | "default" | "lg";
  onChange?: (value: number) => void;
  className?: string;
}) {
  const starSize = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-6 w-6" : "h-4 w-4";
  const interactive = typeof onChange === "function";

  return (
    <div
      className={cn("inline-flex items-center gap-0.5", className)}
      role={interactive ? "radiogroup" : "img"}
      aria-label={interactive ? "Rate" : `Rated ${value} out of ${max}`}
    >
      {Array.from({ length: max }).map((_, i) => {
        // Interactive rating is an integer choice → fill whole stars up to the value.
        if (interactive) {
          const filled = i < Math.round(value);
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i + 1 === Math.round(value)}
              aria-label={`${i + 1} of ${max} stars`}
              onClick={() => onChange(i + 1)}
              className="cursor-pointer rounded transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary"
            >
              <Star
                className={cn(
                  starSize,
                  filled ? "fill-kd-accent text-kd-accent" : "fill-transparent text-kd-fg-subtle",
                )}
              />
            </button>
          );
        }
        // Display: partial-fill so a fractional average (e.g. 4.5) reads accurately
        // instead of rounding 4.5–4.9 up to a full 5 stars.
        const pct = Math.max(0, Math.min(1, value - i)) * 100;
        return (
          <span key={i} aria-hidden className={cn("relative inline-block", starSize)}>
            <Star className={cn(starSize, "fill-transparent text-kd-fg-subtle")} />
            <span
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{ width: `${pct}%` }}
            >
              <Star className={cn(starSize, "fill-kd-accent text-kd-accent")} />
            </span>
          </span>
        );
      })}
      {(typeof count === "number" || !interactive) && (
        <span className="ml-1 text-xs tabular-nums text-kd-fg-muted">
          {!interactive && <span className="font-semibold text-kd-fg">{value.toFixed(1)}</span>}
          {typeof count === "number" && ` (${count})`}
        </span>
      )}
    </div>
  );
}

export { RatingStars };
