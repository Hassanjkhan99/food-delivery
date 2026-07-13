"use client";

// Live rider position for customer order tracking (#162 / UX-07 #42). Uses the keyless
// OpenStreetMap embed so we don't take a tile-provider/API-key dependency ahead of the
// #41 map-tiles decision — swap the iframe for a proper tile layer once that lands.
// The marker re-centres whenever the rider's coordinates change (SSE/poll drives the
// parent refetch), and a freshness line reflects `isStale`/`lastLocationAt`.
import { useMemo } from "react";

function relativeAge(iso: string | null): string {
  if (!iso) return "location not shared yet";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 15) return "updated just now";
  if (secs < 60) return `updated ${secs}s ago`;
  const mins = Math.round(secs / 60);
  return `updated ${mins} min ago`;
}

export function RiderTrackMap({
  lat,
  lng,
  isStale,
  lastLocationAt,
}: {
  lat?: number | null;
  lng?: number | null;
  isStale: boolean;
  lastLocationAt?: string | null;
}) {
  const hasCoords =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);

  // A small bbox (~±0.004° ≈ 400–450m) around the rider so the marker sits mid-map.
  const src = useMemo(() => {
    if (!hasCoords) return null;
    const d = 0.004;
    const bbox = [lng! - d, lat! - d, lng! + d, lat! + d].join(",");
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  }, [hasCoords, lat, lng]);

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-kd-border bg-kd-surface">
      {src ? (
        <iframe
          // key on the coords forces a reload when the rider moves so the marker tracks.
          key={src}
          title="Rider location"
          src={src}
          className="h-48 w-full border-0"
          loading="lazy"
        />
      ) : (
        <div className="flex h-48 w-full items-center justify-center text-sm text-kd-fg-muted">
          Waiting for your rider to share their location…
        </div>
      )}
      <p className="border-t border-kd-border px-3 py-2 text-xs text-kd-fg-muted">
        {!hasCoords || isStale ? (
          <span className="text-kd-warning">
            Locating your rider… ({relativeAge(lastLocationAt ?? null)})
          </span>
        ) : (
          <span>Live · {relativeAge(lastLocationAt ?? null)}</span>
        )}
      </p>
    </div>
  );
}
