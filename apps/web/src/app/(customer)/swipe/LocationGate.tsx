"use client";

// First screen of the deck flow: confirm delivery location before browseBranches can run.
// Reuses the same pilot-zone presets + GPS action as the home feed's AddressChip (lib/location)
// rather than inventing a separate saved-addresses list.
import { Check, Crosshair, MapPin } from "lucide-react";
import { LOCATION_PRESETS, useLocationStore } from "@/lib/location";
import { cn } from "@/lib/utils";

export function LocationGate({ onStart }: { onStart: () => void }) {
  const label = useLocationStore((s) => s.label);
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const setPreset = useLocationStore((s) => s.setPreset);
  const requestGps = useLocationStore((s) => s.requestGps);

  return (
    <div className="mx-auto flex min-h-[75vh] max-w-md flex-col px-1 py-4">
      <div className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-kd-primary to-kd-accent shadow-md">
        <MapPin className="h-8 w-8 text-white" />
      </div>
      <h1 className="mt-5 text-2xl font-bold leading-tight tracking-tight text-kd-fg">
        Where are we
        <br />
        delivering today?
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-kd-fg-muted">
        Confirm your spot so we can stack up nearby kitchens for you to swipe through.
      </p>
      <p className="mt-1 text-xs font-semibold text-kd-fg-subtle">Currently: {label}</p>

      <button
        type="button"
        onClick={requestGps}
        className="mt-5 flex items-center gap-3 rounded-2xl border border-kd-accent-soft bg-kd-primary-soft p-4 text-left active:opacity-85"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-kd-primary">
          <Crosshair className="h-5 w-5 text-white" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-kd-primary-active">
            Use current location
          </span>
          <span className="block text-xs text-kd-primary-hover opacity-75">
            Fastest — powered by GPS
          </span>
        </span>
      </button>

      <p className="mb-2.5 mt-6 text-[11px] font-bold uppercase tracking-wide text-kd-fg-subtle">
        Pilot areas
      </p>
      <div className="flex flex-col gap-2.5">
        {LOCATION_PRESETS.map((p) => {
          const active = Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lng - lng) < 1e-6;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => setPreset(p)}
              className={cn(
                "flex items-center gap-3 rounded-2xl border-[1.5px] bg-kd-surface p-3.5 text-left active:scale-[0.985]",
                active ? "border-kd-primary" : "border-kd-border",
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-kd-surface-muted text-lg">
                📍
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "text-sm",
                      active ? "font-bold text-kd-fg" : "font-semibold text-kd-fg",
                    )}
                  >
                    {p.label}
                  </span>
                  {active && (
                    <span className="rounded-full bg-kd-primary-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-kd-primary">
                      Selected
                    </span>
                  )}
                </span>
              </span>
              {active && <Check className="h-4 w-4 shrink-0 text-kd-primary" />}
            </button>
          );
        })}
      </div>

      <div className="flex-1" />
      <button
        type="button"
        onClick={onStart}
        className="mt-6 w-full rounded-2xl bg-kd-primary py-4 text-base font-semibold text-white shadow-md active:scale-[0.98]"
      >
        Start swiping →
      </button>
    </div>
  );
}
