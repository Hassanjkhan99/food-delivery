"use client";

// Delivery location: Phase 8 (Bahria Town, Rawalpindi) default matching the seeded pilot
// zone. GPS is only read if permission was ALREADY granted — we never trigger the browser
// permission prompt automatically (it blocks headless/preview contexts and annoys users).
import { useEffect, useState } from "react";

export const DEFAULT_LOCATION = { lat: 33.5251, lng: 73.0952, label: "Phase 8, Bahria Town" };

export function useDeliveryLocation() {
  const [loc, setLoc] = useState(DEFAULT_LOCATION);

  useEffect(() => {
    if (!navigator.geolocation || !navigator.permissions) return;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (status.state !== "granted") return;
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            setLoc({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              label: "Current location",
            }),
          () => {},
          { timeout: 5_000 },
        );
      })
      .catch(() => {});
  }, []);

  return { ...loc, source: loc.label === "Current location" ? ("gps" as const) : ("default" as const) };
}
