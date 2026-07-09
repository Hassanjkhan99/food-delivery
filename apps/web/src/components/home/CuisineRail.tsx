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

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
      className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center"
      aria-pressed={selected}
    >
      <span
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-full text-2xl transition-all",
          selected
            ? "bg-rose-600 ring-2 ring-rose-600 ring-offset-2"
            : "bg-neutral-100 hover:bg-neutral-200",
        )}
      >
        {emoji}
      </span>
      <span
        className={cn(
          "line-clamp-1 text-[11px] leading-tight",
          selected ? "font-semibold text-rose-600" : "text-neutral-600",
        )}
      >
        {label}
      </span>
    </button>
  );
}
