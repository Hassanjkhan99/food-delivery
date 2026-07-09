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
      <SheetTrigger className="flex max-w-full items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-200">
        <MapPin className="h-4 w-4 shrink-0 text-rose-600" />
        <span className="text-neutral-500">Deliver to</span>
        <span className="truncate font-semibold text-neutral-900">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
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
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-neutral-100"
          >
            <Crosshair className="h-5 w-5 text-rose-600" />
            <span className="font-medium text-neutral-900">Use my current location</span>
          </button>

          <div className="pt-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
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
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-neutral-100"
              >
                <span className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-neutral-400" />
                  <span
                    className={cn("text-neutral-800", active && "font-semibold text-neutral-900")}
                  >
                    {p.label}
                  </span>
                </span>
                {active && <Check className="h-4 w-4 text-rose-600" />}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
