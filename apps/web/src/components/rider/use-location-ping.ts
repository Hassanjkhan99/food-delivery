"use client";

// Location pings (#47): while a job is active (assigned..picked_up) the rider app posts
// getCurrentPosition every ~20s so the customer's live map (UX-07) can track the rider.
// Best-effort and battery-aware: pings only while `active` is true, stops on unmount,
// and surfaces a permission-denied state so the UI can nudge the rider once. Never blocks
// the lifecycle — a denied/unavailable GPS just means no live dot, not a broken job.
import { useEffect, useRef, useState } from "react";
import { useMutation } from "urql";
import { graphql } from "@/graphql/generated";

const RiderPingMutation = graphql(`
  mutation RiderPing($lat: Float!, $lng: Float!) {
    riderPing(lat: $lat, lng: $lng)
  }
`);

// Active-job cadence: tight, so the customer's live map tracks smoothly.
const PING_INTERVAL_MS = 20_000;
// Online-but-idle cadence (#163): much slower to protect battery — an idle rider only
// needs a fresh-enough fix for dispatch proximity + a head-start dot, not live tracking.
export const IDLE_PING_INTERVAL_MS = 45_000;

export type PingStatus = "idle" | "pinging" | "denied" | "unavailable";

export function useLocationPing(
  active: boolean,
  intervalMs: number = PING_INTERVAL_MS,
): PingStatus {
  const [, ping] = useMutation(RiderPingMutation);
  const [status, setStatus] = useState<PingStatus>("idle");
  // Keep the latest mutation fn in a ref so the interval effect doesn't re-run on every
  // urql render (which would tear down and recreate the timer constantly). Assigned in an
  // effect (never during render) so it stays a pure ref-write.
  const pingRef = useRef(ping);
  useEffect(() => {
    pingRef.current = ping;
  }, [ping]);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const send = () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setStatus("unavailable");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setStatus("pinging");
          void pingRef.current({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        (err) => {
          if (cancelled) return;
          setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
      );
    };

    send();
    const t = setInterval(send, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
      setStatus("idle");
    };
  }, [active, intervalMs]);

  return status;
}
