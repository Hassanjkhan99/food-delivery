"use client";

import * as React from "react";
import { NumberField } from "@base-ui/react/number-field";
import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Quantity stepper on `@base-ui/react/number-field` — accessible −/＋ counter with a
 * typable input, clamping (`min`/`max`) and keyboard/scrub support. Replaces the ad-hoc
 * +/- button pairs in the cart / item cards. Controlled via `value` + `onValueChange`.
 */
function NumberStepper({ className, ...props }: React.ComponentProps<typeof NumberField.Root>) {
  return (
    <NumberField.Root
      data-slot="number-stepper"
      className={cn("inline-flex", className)}
      {...props}
    >
      <NumberField.Group className="inline-flex items-center overflow-hidden rounded-full border border-kd-border bg-kd-surface">
        <NumberField.Decrement className="grid size-9 place-items-center text-kd-fg transition-colors hover:bg-kd-surface-muted disabled:opacity-40">
          <Minus className="h-4 w-4" />
        </NumberField.Decrement>
        <NumberField.Input className="h-9 w-10 border-x border-kd-border bg-transparent text-center text-sm font-semibold tabular-nums text-kd-fg outline-none" />
        <NumberField.Increment className="grid size-9 place-items-center text-kd-fg transition-colors hover:bg-kd-surface-muted disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}

export { NumberStepper };
