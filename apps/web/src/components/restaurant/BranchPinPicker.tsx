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
  // No `marker=` param: the crosshair overlay is the marker, so we avoid a duplicate pin and
  // keep the embed centred on the chosen point.
  const bbox = [lng - SPAN_DEG, lat - SPAN_DEG, lng + SPAN_DEG, lat + SPAN_DEG].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik`;
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
  // handlers don't re-subscribe.
  const drag = useRef<{ x: number; y: number; lat: number; lng: number } | null>(null);
  // Latest previewed centre, written only from the pointer handler (never during render) so
  // endDrag can commit it without a side effect inside a state updater.
  const preview = useRef<{ lat: number; lng: number; moved: boolean } | null>(null);
  // Live drag state: the pixel offset (to CSS-translate the map so it pans smoothly without a
  // tile reload) and the previewed centre coords (for the readout). We DON'T call onChange per
  // pointer move — that would re-key the iframe every pixel and make the OSM embed reload/
  // flicker continuously. onChange fires once, on release. (#200 Codex review.)
  const [dragState, setDragState] = useState<{
    dx: number;
    dy: number;
    lat: number;
    lng: number;
  } | null>(null);

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
      preview.current = { lat, lng, moved: false };
      setDragState({ dx: 0, dy: 0, lat, lng });
    },
    [disabled, lat, lng],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const el = surfaceRef.current;
    if (!start || !el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Pixels moved → degrees, using the bbox span. Dragging right moves the map left, so the
    // centre longitude decreases; dragging down moves the map up, so latitude increases.
    const degPerPxX = (2 * SPAN_DEG) / rect.width;
    const degPerPxY = (2 * SPAN_DEG) / rect.height;
    const nextLng = clampLng(start.lng - dx * degPerPxX);
    const nextLat = clampLat(start.lat + dy * degPerPxY);
    preview.current = { lat: nextLat, lng: nextLng, moved: dx !== 0 || dy !== 0 };
    setDragState({ dx, dy, lat: nextLat, lng: nextLng });
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      drag.current = null;
      surfaceRef.current?.releasePointerCapture(e.pointerId);
      const p = preview.current;
      preview.current = null;
      setDragState(null);
      // Commit the settled centre once; the iframe re-renders at the new coords and the CSS
      // translate resets to zero.
      if (p && p.moved) onChange({ lat: p.lat, lng: p.lng });
    },
    [onChange],
  );

  const dragging = dragState !== null;
  // Coords shown in the readout: the live preview while dragging, else the committed value.
  const shownLat = dragState ? dragState.lat : lat;
  const shownLng = dragState ? dragState.lng : lng;

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
      <div className="relative h-56 overflow-hidden rounded-xl border border-kd-border bg-kd-surface">
        <iframe
          // The iframe centre only changes when the drag settles (or on nudge/GPS), so the OSM
          // tiles reload once per placement instead of every pointer frame. During an active
          // drag we CSS-translate the whole iframe by the pixel delta so the map pans smoothly
          // with no reload/flicker; on release it re-renders at the new committed centre.
          key={embedSrc(lat, lng)}
          title="Branch location"
          src={embedSrc(lat, lng)}
          className="pointer-events-none absolute inset-0 h-full w-full border-0"
          style={
            dragState ? { transform: `translate(${dragState.dx}px, ${dragState.dy}px)` } : undefined
          }
          loading="lazy"
        />
        {/* Transparent drag surface: captures pan gestures without letting the iframe eat them.
            `touch-none` disables the browser's default touch panning so mobile drags deliver
            pointermove events instead of scrolling the page / firing pointercancel. */}
        <div
          ref={surfaceRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`absolute inset-0 touch-none ${
            disabled ? "" : dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          role="application"
          aria-label="Drag the map to place your branch pin"
        />
        {/* Fixed centre crosshair = the chosen pin. The pin tip (bottom-centre of the 30×42
            SVG) must sit on the map centre, so we shift the SVG up by its full height. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg
            width="30"
            height="42"
            viewBox="0 0 30 42"
            aria-hidden="true"
            style={{ transform: "translateY(-21px)" }}
          >
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
          {shownLat.toFixed(5)}, {shownLng.toFixed(5)}
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
