"use client";

import { cn } from "@/lib/utils";
import { cuisineEmoji } from "./cuisineIcons";

/**
 * Horizontally scrolling circular cuisine icons. One tap filters the feed. Only
 * cuisines present in the current results are shown, so a tap never yields an empty
 * feed. `active === null` means "All".
 */
export function CuisineRail({
  cuisines,
  active,
  onSelect,
}: {
  cuisines: string[];
  active: string | null;
  onSelect: (cuisine: string | null) => void;
}) {
  if (cuisines.length === 0) return null;

  // Vertical padding gives the cards' hover-lift + shadow room so they aren't clipped
  // by the horizontal scroll track.
  return (
    <div className="-mx-4 overflow-x-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-4">
        <CuisineButton
          label="All"
          emoji="🍽️"
          selected={active === null}
          onClick={() => onSelect(null)}
        />
        {cuisines.map((c) => (
          <CuisineButton
            key={c}
            label={c}
            emoji={cuisineEmoji(c)}
            selected={active === c}
            onClick={() => onSelect(active === c ? null : c)}
          />
        ))}
      </div>
    </div>
  );
}

function CuisineButton({
  label,
  emoji,
  selected,
  onClick,
}: {
  label: string;
  emoji: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex h-[100px] w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-[20px] border p-4 text-center shadow-[0_6px_18px_rgba(0,0,0,0.05)] transition-all",
        selected
          ? "border-2 border-kd-primary bg-kd-primary-soft"
          : "border-kd-border bg-kd-surface hover:-translate-y-1 hover:shadow-[0_18px_30px_rgba(0,0,0,0.08)]",
      )}
    >
      <span className="text-[40px] leading-none">{emoji}</span>
      <span
        className={cn(
          "line-clamp-1 text-sm font-medium leading-tight",
          selected ? "text-kd-primary" : "text-kd-fg-muted",
        )}
      >
        {label}
      </span>
    </button>
  );
}
