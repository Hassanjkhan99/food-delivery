"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

/**
 * On/off toggle on `@base-ui/react/switch`. Replaces the ~22 ad-hoc styled native
 * checkboxes used as toggles (availability, settings flags, filters). Controlled via
 * `checked` + `onCheckedChange`, or uncontrolled via `defaultChecked`.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-kd-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary focus-visible:ring-offset-2 data-[checked]:bg-kd-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
