"use client";

import { useState } from "react";
import { Check, SlidersHorizontal, X } from "lucide-react";
import { BROWSE_SORTS, CUISINE_TAGS, priceBandLabel, type BrowseSort } from "@fd/shared";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Browse feed filter + sort controls (#51). The active filter/sort live in the page
 * (driving the browseBranches query variables); this component is the presentational
 * shell: a sort selector, a filter sheet with an active-count badge, and one-tap clear.
 */
export type BrowseFilterState = {
  freeDelivery: boolean;
  minRating: number | null; // 0/4.0/4.5
  maxPriceBand: number | null; // 1-3
  openNow: boolean;
  cuisineTags: string[];
};

export const EMPTY_FILTER: BrowseFilterState = {
  freeDelivery: false,
  minRating: null,
  maxPriceBand: null,
  openNow: false,
  cuisineTags: [],
};

const SORT_LABELS: Record<BrowseSort, string> = {
  relevance: "Relevance",
  rating: "Rating",
  distance: "Distance",
  eta: "Delivery time",
  popularity: "Most popular",
};

/** Count of distinct active filter facets (drives the badge on the Filters button). */
export function activeFilterCount(f: BrowseFilterState): number {
  return (
    (f.freeDelivery ? 1 : 0) +
    (f.minRating != null ? 1 : 0) +
    (f.maxPriceBand != null ? 1 : 0) +
    (f.openNow ? 1 : 0) +
    f.cuisineTags.length
  );
}

export function BrowseControls({
  sort,
  onSortChange,
  filter,
  onFilterChange,
}: {
  sort: BrowseSort;
  onSortChange: (s: BrowseSort) => void;
  filter: BrowseFilterState;
  onFilterChange: (f: BrowseFilterState) => void;
}) {
  const count = activeFilterCount(filter);

  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <FilterSheet count={count} filter={filter} onApply={onFilterChange} />

      <label className="relative shrink-0">
        <span className="sr-only">Sort restaurants</span>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as BrowseSort)}
          className="h-12 cursor-pointer rounded-full border border-kd-border bg-kd-surface pl-5 pr-9 text-base font-medium text-kd-fg outline-none hover:border-kd-primary focus:border-kd-primary focus:ring-2 focus:ring-kd-primary-soft"
        >
          {BROWSE_SORTS.map((s) => (
            <option key={s} value={s}>
              Sort: {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      {/* Quick-toggle chips mirror the most common Foodpanda filters. */}
      <QuickChip
        label="Free delivery"
        active={filter.freeDelivery}
        onClick={() => onFilterChange({ ...filter, freeDelivery: !filter.freeDelivery })}
      />
      <QuickChip
        label="Open now"
        active={filter.openNow}
        onClick={() => onFilterChange({ ...filter, openNow: !filter.openNow })}
      />
      <QuickChip
        label="4.0+"
        active={filter.minRating === 4.0}
        onClick={() =>
          onFilterChange({ ...filter, minRating: filter.minRating === 4.0 ? null : 4.0 })
        }
      />
    </div>
  );
}

function QuickChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-12 shrink-0 items-center rounded-full border px-5 text-base font-medium transition-colors",
        active
          ? "border-kd-primary bg-kd-primary text-white"
          : "border-kd-border bg-kd-surface text-kd-fg hover:border-kd-primary hover:bg-kd-surface-muted",
      )}
    >
      {label}
    </button>
  );
}

function FilterSheet({
  count,
  filter,
  onApply,
}: {
  count: number;
  filter: BrowseFilterState;
  onApply: (f: BrowseFilterState) => void;
}) {
  const [open, setOpen] = useState(false);
  // Draft state so edits inside the sheet only commit on "Apply".
  const [draft, setDraft] = useState<BrowseFilterState>(filter);

  // Re-seed the draft from the live filter whenever the sheet opens.
  function handleOpenChange(next: boolean) {
    if (next) setDraft(filter);
    setOpen(next);
  }

  function apply() {
    onApply(draft);
    setOpen(false);
  }

  function clearDraft() {
    setDraft(EMPTY_FILTER);
  }

  function toggleCuisine(tag: string) {
    setDraft((d) => ({
      ...d,
      cuisineTags: d.cuisineTags.includes(tag)
        ? d.cuisineTags.filter((t) => t !== tag)
        : [...d.cuisineTags, tag],
    }));
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <button
            type="button"
            className="relative flex h-12 shrink-0 items-center gap-2 rounded-full border border-kd-border bg-kd-surface px-5 text-base font-medium text-kd-fg transition-colors hover:border-kd-primary hover:bg-kd-surface-muted"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" />
            Filters
            {count > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-kd-primary px-1 text-xs font-bold text-white">
                {count}
              </span>
            )}
          </button>
        }
      />
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="border-b border-kd-border">
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 px-4">
          <FilterToggle
            label="Free delivery"
            checked={draft.freeDelivery}
            onChange={(v) => setDraft((d) => ({ ...d, freeDelivery: v }))}
          />
          <FilterToggle
            label="Open now"
            checked={draft.openNow}
            onChange={(v) => setDraft((d) => ({ ...d, openNow: v }))}
          />

          <FilterGroup title="Rating">
            <PillRow
              options={[
                { key: "any", label: "Any", value: null },
                { key: "4.0", label: "4.0+", value: 4.0 },
                { key: "4.5", label: "4.5+", value: 4.5 },
              ]}
              selected={draft.minRating}
              onSelect={(v) => setDraft((d) => ({ ...d, minRating: v }))}
            />
          </FilterGroup>

          <FilterGroup title="Price">
            <PillRow
              options={[
                { key: "any", label: "Any", value: null },
                { key: "1", label: priceBandLabel(1), value: 1 },
                { key: "2", label: priceBandLabel(2), value: 2 },
                { key: "3", label: priceBandLabel(3), value: 3 },
              ]}
              selected={draft.maxPriceBand}
              onSelect={(v) => setDraft((d) => ({ ...d, maxPriceBand: v }))}
            />
          </FilterGroup>

          <FilterGroup title="Cuisine">
            <div className="flex flex-wrap gap-2">
              {CUISINE_TAGS.map((tag) => {
                const active = draft.cuisineTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleCuisine(tag)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "border-kd-primary bg-kd-primary-soft text-kd-primary"
                        : "border-kd-border bg-kd-surface text-kd-fg-muted hover:bg-kd-surface-muted",
                    )}
                  >
                    {active && <Check className="h-3.5 w-3.5" />}
                    {tag}
                  </button>
                );
              })}
            </div>
          </FilterGroup>
        </div>

        <SheetFooter className="flex-row gap-3 border-t border-kd-border">
          <Button variant="outline" className="flex-1" onClick={clearDraft}>
            Clear all
          </Button>
          <Button className="flex-1" onClick={apply}>
            Apply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-kd-fg">{title}</h3>
      {children}
    </div>
  );
}

function FilterToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between"
    >
      <span className="text-sm font-medium text-kd-fg">{label}</span>
      <span
        className={cn(
          "relative h-6 w-10 rounded-full transition-colors",
          checked ? "bg-kd-primary" : "bg-kd-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

function PillRow<T extends number | null>({
  options,
  selected,
  onSelect,
}: {
  options: { key: string; label: string; value: T }[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === selected;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onSelect(o.value)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "border-kd-primary bg-kd-primary-soft text-kd-primary"
                : "border-kd-border bg-kd-surface text-kd-fg-muted hover:bg-kd-surface-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Removable chips summarising the active filters, shown above the feed. */
export function ActiveFilterChips({
  filter,
  onFilterChange,
}: {
  filter: BrowseFilterState;
  onFilterChange: (f: BrowseFilterState) => void;
}) {
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filter.freeDelivery)
    chips.push({
      key: "free",
      label: "Free delivery",
      clear: () => onFilterChange({ ...filter, freeDelivery: false }),
    });
  if (filter.openNow)
    chips.push({
      key: "open",
      label: "Open now",
      clear: () => onFilterChange({ ...filter, openNow: false }),
    });
  if (filter.minRating != null)
    chips.push({
      key: "rating",
      label: `${filter.minRating.toFixed(1)}+`,
      clear: () => onFilterChange({ ...filter, minRating: null }),
    });
  if (filter.maxPriceBand != null)
    chips.push({
      key: "price",
      label: `Up to ${priceBandLabel(filter.maxPriceBand)}`,
      clear: () => onFilterChange({ ...filter, maxPriceBand: null }),
    });
  for (const tag of filter.cuisineTags)
    chips.push({
      key: `cuisine-${tag}`,
      label: tag,
      clear: () =>
        onFilterChange({ ...filter, cuisineTags: filter.cuisineTags.filter((t) => t !== tag) }),
    });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <span
          key={c.key}
          className="flex items-center gap-1 rounded-full bg-kd-primary-soft py-1 pl-3 pr-1.5 text-sm font-medium text-kd-primary"
        >
          {c.label}
          <button
            type="button"
            onClick={c.clear}
            aria-label={`Remove ${c.label} filter`}
            className="grid h-5 w-5 place-items-center rounded-full hover:bg-kd-primary/15"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onFilterChange(EMPTY_FILTER)}
        className="text-sm font-medium text-kd-fg-muted underline-offset-2 hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
