"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

/**
 * Tabbed content on `@base-ui/react/tabs` — proper `tablist` / `tab` / `tabpanel` ARIA
 * and keyboard nav (arrow keys, Home/End), which the ~22 hand-rolled button-list "tabs"
 * across the app all lack. For a value selector without panels (sort/filter switches),
 * use `SegmentedControl` below.
 */

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

/** Underline tab strip. */
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex items-center gap-4 border-b border-kd-border", className)}
      {...props}
    />
  );
}

function TabsTab({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "-mb-px cursor-pointer border-b-2 border-transparent pb-2 text-sm font-medium text-kd-fg-muted transition-colors hover:text-kd-fg focus-visible:outline-none focus-visible:text-kd-fg data-[active]:border-kd-primary data-[active]:text-kd-fg",
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("focus-visible:outline-none", className)}
      {...props}
    />
  );
}

/**
 * Compact pill-group value selector (no panels) — the shape most of the app's inline
 * "filter tabs" actually are. Controlled: pass `value` + `onValueChange`.
 * `glass` renders the container as frosted glass (for sticky headers over content).
 */
function SegmentedControl({
  options,
  value,
  onValueChange,
  glass = false,
  className,
}: {
  options: { value: string; label: React.ReactNode }[];
  value: string;
  onValueChange: (value: string) => void;
  glass?: boolean;
  className?: string;
}) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(v) => onValueChange(String(v))}
      data-slot="segmented-control"
    >
      <TabsPrimitive.List
        className={cn(
          "inline-flex items-center gap-1 rounded-full p-1",
          glass ? "kd-glass-sheet" : "bg-kd-surface-muted",
          className,
        )}
      >
        {options.map((o) => (
          <TabsPrimitive.Tab
            key={o.value}
            value={o.value}
            className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium text-kd-fg-muted transition-colors hover:text-kd-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary data-[active]:bg-kd-surface data-[active]:text-kd-fg data-[active]:shadow-sm"
          >
            {o.label}
          </TabsPrimitive.Tab>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

export { Tabs, TabsList, TabsTab, TabsPanel, SegmentedControl };
