"use client";

import { useState } from "react";
import { Check, ChevronDown, Crosshair, MapPin } from "lucide-react";
import { LOCATION_PRESETS, useLocationStore } from "@/lib/location";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Tappable delivery-address chip. Opens a sheet to switch between pilot-zone presets
 * or use the device GPS. Full saved-address book (map pin, labels) is issue #40/#41 —
 * this is the always-one-tap-away entry point the home feed reads from.
 */
export function AddressChip() {
  const [open, setOpen] = useState(false);
  const label = useLocationStore((s) => s.label);
  const setPreset = useLocationStore((s) => s.setPreset);
  const requestGps = useLocationStore((s) => s.requestGps);
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="flex max-w-full items-center gap-1.5 rounded-full bg-kd-surface-muted px-3 py-1.5 text-sm text-kd-fg-muted transition-colors hover:bg-kd-border">
        <MapPin className="h-4 w-4 shrink-0 text-kd-primary" />
        <span className="text-kd-fg-muted">Deliver to</span>
        <span className="truncate font-semibold text-kd-fg">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-kd-fg-subtle" />
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl pb-4">
        <SheetHeader>
          <SheetTitle>Delivery location</SheetTitle>
          <SheetDescription>Choose where your order should be delivered.</SheetDescription>
        </SheetHeader>

        <div className="space-y-1 px-4">
          <button
            type="button"
            onClick={() => {
              requestGps();
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-kd-surface-muted"
          >
            <Crosshair className="h-5 w-5 text-kd-primary" />
            <span className="font-medium text-kd-fg">Use my current location</span>
          </button>

          <div className="pt-1 text-xs font-medium uppercase tracking-wide text-kd-fg-subtle">
            Pilot areas
          </div>
          {LOCATION_PRESETS.map((p) => {
            const active = Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lng - lng) < 1e-6;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setPreset(p);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-kd-surface-muted"
              >
                <span className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-kd-fg-subtle" />
                  <span className={cn("text-kd-fg-muted", active && "font-semibold text-kd-fg")}>
                    {p.label}
                  </span>
                </span>
                {active && <Check className="h-4 w-4 text-kd-primary" />}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
