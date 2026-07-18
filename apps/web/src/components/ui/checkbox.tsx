"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Checkbox on `@base-ui/react/checkbox` (supports `indeterminate`). Use for multi-select
 * lists and standalone opt-ins; for an on/off setting prefer `<Switch>`.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-kd-border bg-kd-surface text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary focus-visible:ring-offset-2 data-[checked]:border-kd-primary data-[checked]:bg-kd-primary data-[indeterminate]:border-kd-primary data-[indeterminate]:bg-kd-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex">
        <Minus className="hidden size-3.5 group-data-[indeterminate]:block" />
        <Check className="size-3.5 group-data-[indeterminate]:hidden" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
