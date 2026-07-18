"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

/**
 * Hover/focus tooltip on `@base-ui/react/tooltip` — accessible replacement for native
 * `title=` attributes. Wrap the trigger element as `children`; it becomes the anchor.
 *
 *   <Tooltip content="Copy link"><button>…</button></Tooltip>
 *
 * Wrap a subtree in `<TooltipProvider>` to share open/close delays between many tooltips.
 */
const TooltipProvider = TooltipPrimitive.Provider;

function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={6} className="z-50">
          <TooltipPrimitive.Popup
            className={cn(
              "rounded-md bg-kd-fg px-2 py-1 text-xs font-medium text-kd-bg shadow-kd-md",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { Tooltip, TooltipProvider };
