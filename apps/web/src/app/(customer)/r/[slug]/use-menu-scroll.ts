"use client";

// Scroll plumbing for the restaurant menu: which section is in view (to highlight
// the sticky rail) and whether the hero has scrolled off (to collapse it into a
// compact title bar). Both are IntersectionObserver-based so there's no scroll
// handler running on every frame.
import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Returns the id of the menu section currently occupying the top band of the
 * viewport, so the category rail can highlight it while the user scrolls.
 * `ids` are the section element ids (e.g. `cat-<id>`), in render order.
 */
export function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  // Join is a cheap stable key for the effect dep — ids are short and stable.
  const key = ids.join("|");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || ids.length === 0) return;
    // Track the top offset of every intersecting section; the topmost one wins.
    const tops = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) tops.set(e.target.id, e.boundingClientRect.top);
          else tops.delete(e.target.id);
        }
        let best: { id: string; top: number } | null = null;
        for (const [id, top] of tops) {
          if (!best || top < best.top) best = { id, top };
        }
        if (best) setActive(best.id);
      },
      // Band just below the sticky nav down to ~40% of the viewport.
      { rootMargin: "-150px 0px -55% 0px", threshold: 0 },
    );
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}

/**
 * True once the given element (a sentinel at the bottom of the hero) has scrolled
 * out of view — the cue to reveal the compact title bar.
 */
export function useHeroCollapsed<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  collapsed: boolean;
} {
  const ref = useRef<T>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), {
      rootMargin: "-60px 0px 0px 0px",
      threshold: 0,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, collapsed };
}
