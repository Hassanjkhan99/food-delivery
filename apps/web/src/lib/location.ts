"use client";

// Delivery location (zustand, localStorage-persisted). Default = Phase 8 (Bahria Town,
// Rawalpindi), the seeded pilot zone. The address chip lets the customer switch between
// a few pilot presets or opt into GPS. We never trigger the browser geolocation prompt
// automatically (it blocks headless/preview contexts) — GPS is only read on an explicit
// user action, or silently if permission was ALREADY granted.
import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DeliveryLocation = {
  lat: number;
  lng: number;
  label: string;
  source: "default" | "preset" | "gps";
};

export const DEFAULT_LOCATION: DeliveryLocation = {
  lat: 33.5251,
  lng: 73.0952,
  label: "Phase 8, Bahria Town",
  source: "default",
};

// Pilot-zone presets the customer can switch between. The last one is intentionally
// out of most delivery radii so the empty state is reachable in a demo.
export const LOCATION_PRESETS: Omit<DeliveryLocation, "source">[] = [
  { lat: 33.5251, lng: 73.0952, label: "Phase 8, Bahria Town" },
  { lat: 33.534, lng: 73.081, label: "Phase 7, Bahria Town" },
  { lat: 33.51, lng: 73.115, label: "Phase 4, Bahria Town" },
  { lat: 33.55, lng: 73.16, label: "DHA Phase 2 (far)" },
];

type LocationState = DeliveryLocation & {
  setPreset: (p: Omit<DeliveryLocation, "source">) => void;
  requestGps: () => void;
};

export const useLocationStore = create<LocationState>()(
  persist(
    (set) => ({
      ...DEFAULT_LOCATION,
      setPreset: (p) => set({ ...p, source: "preset" }),
      requestGps: () => {
        if (typeof navigator === "undefined" || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            set({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              label: "Current location",
              source: "gps",
            }),
          () => {},
          { timeout: 5_000 },
        );
      },
    }),
    { name: "fd-location" },
  ),
);

/**
 * Read the current delivery location. On first mount it silently adopts GPS IF
 * permission was already granted (never prompts) — but ONLY when the user hasn't
 * explicitly chosen a preset, otherwise a persisted "Phase 7"/"DHA" choice would be
 * snapped back to GPS on every reload/navigation. `requestGps()` stays the explicit
 * override. Backward-compatible shape.
 */
export function useDeliveryLocation(): DeliveryLocation {
  const { lat, lng, label, source } = useLocationStore();

  useEffect(() => {
    // Never override an explicit preset the customer picked (persisted in fd-location).
    if (useLocationStore.getState().source === "preset") return;
    if (!navigator.geolocation || !navigator.permissions) return;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (status.state !== "granted") return;
        // Re-check right before firing the async GPS read — the customer may have picked
        // a preset while the permissions query was in flight.
        if (useLocationStore.getState().source === "preset") return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            // And re-check AGAIN in the position callback: getCurrentPosition is async, so
            // an explicit preset chosen between the request and the fix must win. Without
            // this, the stale closure would silently snap the customer back to GPS. — #36
            // review round 2.
            if (useLocationStore.getState().source === "preset") return;
            useLocationStore.setState({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              label: "Current location",
              source: "gps",
            });
          },
          () => {},
          { timeout: 5_000 },
        );
      })
      .catch(() => {});
  }, []);

  return { lat, lng, label, source };
}
