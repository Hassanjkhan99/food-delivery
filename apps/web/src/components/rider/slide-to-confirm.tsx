"use client";

// Slide-to-confirm (#47): fat-finger protection on the money step (Mark delivered).
// The rider drags the knob to the far edge to fire `onConfirm`. Pointer-events based
// so it works with touch and mouse (desktop demo). Falls back gracefully: if the
// gesture is awkward, the knob snaps back and nothing fires. Disabled state freezes it.
import { useCallback, useRef, useState } from "react";
import { ChevronsRightIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function SlideToConfirm({
  label,
  confirmingLabel = "Confirming…",
  onConfirm,
  disabled = false,
}: {
  label: string;
  confirmingLabel?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const startX = useRef(0);
  const KNOB = 56; // px, matches the knob width below

  const maxOffset = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 0;
    return Math.max(0, track.clientWidth - KNOB - 8);
  }, []);

  const end = useCallback(async () => {
    if (!dragging) return;
    setDragging(false);
    const max = maxOffset();
    if (offset >= max - 4 && max > 0) {
      setOffset(max);
      setConfirming(true);
      try {
        await onConfirm();
      } finally {
        // Reset so a failed confirm can be retried.
        setConfirming(false);
        setOffset(0);
      }
    } else {
      setOffset(0);
    }
  }, [dragging, offset, maxOffset, onConfirm]);

  if (disabled) {
    return (
      <div className="flex h-14 w-full items-center justify-center rounded-full bg-kd-surface-muted text-sm font-medium text-kd-fg-subtle">
        {label}
      </div>
    );
  }

  return (
    <div
      ref={trackRef}
      className="relative h-14 w-full touch-none overflow-hidden rounded-full bg-kd-primary-soft select-none"
      onPointerMove={(e) => {
        if (!dragging) return;
        const next = Math.min(maxOffset(), Math.max(0, e.clientX - startX.current));
        setOffset(next);
      }}
      onPointerUp={end}
      onPointerLeave={end}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-kd-primary">
        {confirming ? confirmingLabel : label}
      </div>
      <button
        type="button"
        aria-label={label}
        disabled={confirming}
        className={cn(
          "absolute top-1 left-1 flex h-12 w-12 items-center justify-center rounded-full bg-kd-primary text-white shadow-sm",
          !dragging && "transition-transform",
        )}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(e) => {
          if (confirming) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          startX.current = e.clientX - offset;
          setDragging(true);
        }}
      >
        {confirming ? <CheckIcon className="size-5" /> : <ChevronsRightIcon className="size-5" />}
      </button>
    </div>
  );
}
