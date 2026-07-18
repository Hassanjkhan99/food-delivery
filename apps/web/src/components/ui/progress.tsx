"use client";

import * as React from "react";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";

import { cn } from "@/lib/utils";

/**
 * Determinate progress bar on `@base-ui/react/progress`. Pass `value` 0–100 (or `null`
 * for indeterminate). Used for verification / onboarding / upload progress.
 */
function Progress({ className, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root data-slot="progress" className={cn("w-full", className)} {...props}>
      <ProgressPrimitive.Track className="h-2 w-full overflow-hidden rounded-full bg-kd-surface-muted">
        <ProgressPrimitive.Indicator className="h-full rounded-full bg-kd-primary transition-all duration-300" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
