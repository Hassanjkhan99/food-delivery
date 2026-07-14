"use client";

// Keyless branch map-pin picker (#200). Reuses the same keyless OpenStreetMap embed the
// customer rider-track map uses (components/orders/rider-track-map.tsx) — no Leaflet, no
// Google Maps, no API key. The pin is the fixed centre crosshair; the owner pans the map
// (drag, arrow-nudge, or GPS) until the crosshair sits on their branch, and the current
// centre becomes the branch lat/lng. A transparent drag surface over the iframe converts
// pointer movement into a lat/lng pan using the embed's known bbox (degrees-per-pixel), so
// we get real drag-to-place without depending on iframe internals.
import { useCallback, useRef, useState } from "react";

// Half-width of the embed bbox in degrees (≈500–600m at the pilot latitude). Also the pan
// sensitivity: the visible map spans 2*SPAN_DEG across its pixel width.
const SPAN_DEG = 0.006;
// One arrow-nudge step (~55m). Coarse enough to be useful, fine enough to line up a rooftop.
const NUDGE_DEG = 0.0005;

function clampLat(v: number) {
  return Math.min(90, Math.max(-90, v));
}
function clampLng(v: number) {
  return Math.min(180, Math.max(-180, v));
}

function embedSrc(lat: number, lng: number): string {
  const bbox = [lng - SPAN_DEG, lat - SPAN_DEG, lng + SPAN_DEG, lat + SPAN_DEG].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

export function BranchPinPicker({
  lat,
  lng,
  onChange,
  disabled,
}: {
  lat: number;
  lng: number;
  onChange: (next: { lat: number; lng: number }) => void;
  disabled?: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // Drag bookkeeping: pointer start + the centre at drag start. Kept in a ref so the pointer
  // handlers don't re-subscribe and we avoid re-rendering the iframe mid-drag.
  const drag = useRef<{ x: number; y: number; lat: number; lng: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const applyDelta = useCallback(
    (dLat: number, dLng: number) => {
      onChange({ lat: clampLat(lat + dLat), lng: clampLng(lng + dLng) });
    },
    [lat, lng, onChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const el = surfaceRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, lat, lng };
      setDragging(true);
    },
    [disabled, lat, lng],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      const el = surfaceRef.current;
      if (!start || !el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Pixels moved → degrees, using the bbox span. Dragging right moves the map left, so the
      // centre longitude decreases; dragging down moves the map up, so latitude increases.
      const degPerPxX = (2 * SPAN_DEG) / rect.width;
      const degPerPxY = (2 * SPAN_DEG) / rect.height;
      const nextLng = clampLng(start.lng - (e.clientX - start.x) * degPerPxX);
      const nextLat = clampLat(start.lat + (e.clientY - start.y) * degPerPxY);
      onChange({ lat: nextLat, lng: nextLng });
    },
    [onChange],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    surfaceRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  const useGps = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 5_000 },
    );
  }, [onChange]);

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-kd-border bg-kd-surface">
        <iframe
          // Reload the tiles only when the centre settles (not on every drag frame) by keying
          // off the rounded coords; the crosshair overlay tracks the live centre meanwhile.
          key={embedSrc(lat, lng)}
          title="Branch location"
          src={embedSrc(lat, lng)}
          className="pointer-events-none h-56 w-full border-0"
          loading="lazy"
        />
        {/* Transparent drag surface: captures pan gestures without letting the iframe eat them. */}
        <div
          ref={surfaceRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`absolute inset-0 ${
            disabled ? "" : dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          role="application"
          aria-label="Drag the map to place your branch pin"
        />
        {/* Fixed centre crosshair = the chosen pin. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg width="30" height="42" viewBox="0 0 30 42" aria-hidden="true">
            <path
              d="M15 0C7 0 0 6.6 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.6 23 0 15 0z"
              fill="var(--kd-primary, #e11d48)"
              stroke="#fff"
              strokeWidth="2"
            />
            <circle cx="15" cy="15" r="5" fill="#fff" />
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-grid grid-cols-3 gap-1" aria-label="Nudge pin">
          <span />
          <NudgeButton
            label="Move pin north"
            disabled={disabled}
            onClick={() => applyDelta(NUDGE_DEG, 0)}
          >
            ↑
          </NudgeButton>
          <span />
          <NudgeButton
            label="Move pin west"
            disabled={disabled}
            onClick={() => applyDelta(0, -NUDGE_DEG)}
          >
            ←
          </NudgeButton>
          <NudgeButton
            label="Move pin south"
            disabled={disabled}
            onClick={() => applyDelta(-NUDGE_DEG, 0)}
          >
            ↓
          </NudgeButton>
          <NudgeButton
            label="Move pin east"
            disabled={disabled}
            onClick={() => applyDelta(0, NUDGE_DEG)}
          >
            →
          </NudgeButton>
        </div>
        <button
          type="button"
          onClick={useGps}
          disabled={disabled}
          className="rounded-lg border border-kd-border px-3 py-1.5 text-xs font-medium hover:bg-kd-surface-muted disabled:opacity-50"
        >
          Use my current location
        </button>
        <span className="text-xs tabular-nums text-kd-fg-subtle">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
      </div>
    </div>
  );
}

function NudgeButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-kd-border text-sm hover:bg-kd-surface-muted disabled:opacity-50"
    >
      {children}
    </button>
  );
}
