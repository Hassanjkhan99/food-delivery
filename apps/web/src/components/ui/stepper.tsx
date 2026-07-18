import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Vertical stepper / status timeline. `current` is the index of the active step; earlier
 * steps render as complete (check + filled connector). Used for order tracking and
 * multi-step flows (onboarding, verification, menu import).
 */
export type Step = { label: React.ReactNode; description?: React.ReactNode };

function Stepper({
  steps,
  current,
  className,
}: {
  steps: Step[];
  current: number;
  className?: string;
}) {
  return (
    <ol data-slot="stepper" className={cn(className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const last = i === steps.length - 1;
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold",
                  done
                    ? "border-kd-primary bg-kd-primary text-white"
                    : active
                      ? "border-kd-primary text-kd-primary"
                      : "border-kd-border text-kd-fg-subtle",
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              {!last && (
                <span className={cn("w-0.5 flex-1", done ? "bg-kd-primary" : "bg-kd-border")} />
              )}
            </div>
            <div className={cn(last ? "pb-0" : "pb-6")}>
              <p
                className={cn(
                  "text-sm font-medium",
                  done || active ? "text-kd-fg" : "text-kd-fg-muted",
                )}
              >
                {s.label}
              </p>
              {s.description && <p className="mt-0.5 text-xs text-kd-fg-muted">{s.description}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { Stepper };
