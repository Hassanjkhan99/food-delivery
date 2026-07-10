"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { HomeBanner } from "./types";

const ADVANCE_MS = 5_000;

/** Auto-advancing promo banner carousel. Pauses on hover; dots jump; each slide
 *  deep-links via linkHref. Images are static SVGs served from /public. */
export function PromoCarousel({ banners }: { banners: HomeBanner[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = banners.length;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (count <= 1 || paused) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % count), ADVANCE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [count, paused]);

  if (count === 0) return null;

  // Clamp the active index into range for rendering: when the banner list shrinks (e.g. a
  // promo is filtered out because its restaurant stopped delivering to the current area),
  // the stored `index` can point past the end and render an empty/broken slide. Deriving a
  // safe index here fixes the render immediately; the auto-advance modulo and in-range dot
  // clicks bring the stored `index` back into range on their own (no setState-in-effect,
  // which cascades renders). — #36 review round 2.
  const safeIndex = Math.min(index, count - 1);

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${safeIndex * 100}%)` }}
      >
        {banners.map((b) => {
          const inner = (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={b.imageUrl}
              alt={b.title}
              className="aspect-[10/3] w-full shrink-0 object-cover"
            />
          );
          return (
            <div key={b.id} className="w-full shrink-0">
              {b.linkHref ? (
                <Link href={b.linkHref} aria-label={b.title}>
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                "h-1.5 rounded-full bg-white/70 transition-all",
                i === safeIndex ? "w-5 bg-white" : "w-1.5",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
