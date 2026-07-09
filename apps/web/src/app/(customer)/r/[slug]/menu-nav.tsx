"use client";

// The sticky control block under the hero: a compact restaurant title that slides in
// once the hero scrolls away, an in-menu search field, and the category rail whose
// active chip tracks the section in view (scroll-sync) and jumps on tap. One sticky
// container so the title + rail never overlap (two `sticky` siblings would).
import { useEffect, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Search, Star, X } from "lucide-react";

export type NavSection = { domId: string; name: string };

export function MenuNav({
  sections,
  activeId,
  collapsed,
  title,
  avgRating,
  ratingCount,
  reviewsHref,
  search,
  onSearch,
  onJump,
}: {
  sections: NavSection[];
  activeId: string | null;
  collapsed: boolean;
  title: string;
  avgRating?: number | null;
  ratingCount: number;
  reviewsHref: string;
  search: string;
  onSearch: (value: string) => void;
  onJump: (domId: string) => void;
}) {
  const reduced = useReducedMotion();
  const railRef = useRef<HTMLDivElement>(null);

  // Keep the highlighted chip in view as the user scrolls through sections.
  useEffect(() => {
    const el = railRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [activeId, reduced]);

  return (
    <div
      className="sticky top-14 z-30 -mx-4 mb-6 border-b border-black/5 backdrop-blur"
      style={{ backgroundColor: "color-mix(in srgb, var(--brand-bg) 88%, transparent)" }}
    >
      <AnimatePresence initial={false}>
        {collapsed && (
          <motion.div
            key="compact-title"
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-2">
              <h2
                className="truncate text-base font-bold"
                style={{ color: "var(--brand-primary)" }}
              >
                {title}
              </h2>
              {avgRating != null && (
                <Link
                  href={reviewsHref}
                  className="flex shrink-0 items-center gap-1 text-xs font-medium opacity-80 hover:opacity-100"
                >
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {avgRating.toFixed(1)} ({ratingCount})
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-4 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search the menu"
            aria-label="Search the menu"
            className="w-full rounded-full border border-black/10 bg-white/70 py-2 pl-9 pr-9 text-sm outline-none focus:border-black/20"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearch("")}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {sections.length > 0 && (
          <div ref={railRef} className="mt-2 flex gap-2 overflow-x-auto pb-2">
            {sections.map((s) => {
              const active = s.domId === activeId;
              return (
                <button
                  key={s.domId}
                  type="button"
                  data-active={active}
                  onClick={() => onJump(s.domId)}
                  className="whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition"
                  style={
                    active
                      ? { backgroundColor: "var(--brand-primary)", color: "#fff" }
                      : {
                          backgroundColor:
                            "color-mix(in srgb, var(--brand-primary) 12%, transparent)",
                          color: "var(--brand-primary)",
                        }
                  }
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
