"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Heart, Star } from "lucide-react";
import { formatRs } from "@fd/shared";
import { RestaurantImage } from "@/components/media/RestaurantImage";
import { cn } from "@/lib/utils";
import type { FeedHit } from "./types";

/** Availability label for a branch: hours-closed > paused > open. */
function availability(hit: FeedHit): { closed: boolean; label: string | null } {
  if (!hit.isOpenNow) {
    return {
      closed: true,
      label: hit.opensAtLabel ? `Closed · opens ${hit.opensAtLabel}` : "Closed",
    };
  }
  if (!hit.isAcceptingOrders) return { closed: true, label: "Temporarily paused" };
  return { closed: false, label: null };
}

/** Favorite heart — visual affordance; persistence is a future feature (no backend yet),
 *  so this is an optimistic local toggle that doesn't navigate the card. */
function FavoriteButton() {
  const [saved, setSaved] = useState(false);
  return (
    <button
      type="button"
      aria-label={saved ? "Remove from saved" : "Save restaurant"}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        setSaved((v) => !v);
      }}
      className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-kd-fg-muted shadow-sm backdrop-blur transition-colors hover:bg-white"
    >
      <Heart className={cn("h-4 w-4", saved && "fill-kd-primary text-kd-primary")} />
    </button>
  );
}

function DeliveryFee({ minor }: { minor: number }) {
  if (minor === 0) return <span className="font-semibold text-kd-success">Free delivery</span>;
  return <span>{formatRs(minor)} delivery</span>;
}

/** Full-width rich card for the main vertical feed. */
export function RestaurantCard({ hit }: { hit: FeedHit }) {
  const r = hit.restaurant;
  const avail = availability(hit);

  return (
    <Link href={`/r/${r.slug}`} className="group block">
      <article className="h-full overflow-hidden rounded-2xl border border-kd-border bg-kd-surface shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="relative">
          <RestaurantImage
            photo={hit.photo}
            name={r.name}
            tint={r.primaryColor}
            className={cn(
              "aspect-[16/10] w-full transition-transform duration-300 group-hover:scale-[1.03]",
              avail.closed && "grayscale-[0.6]",
            )}
          />

          {hit.deliveryFeeMinor === 0 && !avail.closed && (
            <span className="absolute left-3 top-3 rounded-full bg-kd-success px-2.5 py-1 text-xs font-bold leading-none text-white shadow-sm">
              Free delivery
            </span>
          )}

          <FavoriteButton />

          {avail.closed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/45 text-center">
              <span className="rounded-full bg-white/95 px-3 py-1.5 text-sm font-bold text-kd-fg">
                {avail.label}
              </span>
              <span className="text-xs font-semibold text-white/90">Pre-order for later</span>
            </div>
          ) : (
            r.avgRating != null && (
              <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-xs font-bold text-kd-fg shadow-sm">
                <Star className="h-3 w-3 fill-kd-accent text-kd-accent" />
                {r.avgRating.toFixed(1)}
                <span className="font-medium text-kd-fg-muted">({r.ratingCount})</span>
              </span>
            )
          )}
        </div>

        <div className="p-4">
          <h3 className="font-semibold leading-tight tracking-tight text-kd-fg">{r.name}</h3>

          {r.cuisineTags.length > 0 && (
            <p className="mt-0.5 truncate text-sm text-kd-fg-muted">{r.cuisineTags.join(" · ")}</p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-kd-fg-muted tabular-nums">
            <span className="flex items-center gap-1 font-semibold text-kd-fg">
              <Clock className="h-3.5 w-3.5" /> {hit.etaMinutes}–{hit.etaMinutes + 10} min
            </span>
            <span className="text-kd-fg-subtle">·</span>
            <DeliveryFee minor={hit.deliveryFeeMinor} />
            <span className="text-kd-fg-subtle">·</span>
            <span>{(hit.distanceM / 1000).toFixed(1)} km</span>
            <span className="text-kd-fg-subtle">·</span>
            <span>Min {formatRs(hit.minOrderMinor)}</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

/** Compact card for horizontal swimlanes / "order again". */
export function RestaurantMiniCard({ hit }: { hit: FeedHit }) {
  const r = hit.restaurant;
  const avail = availability(hit);
  return (
    <Link href={`/r/${r.slug}`} className="group block w-44 shrink-0">
      <div className="relative">
        <RestaurantImage
          photo={hit.photo}
          name={r.name}
          tint={r.primaryColor}
          className={cn("aspect-[16/10] w-44 rounded-xl", avail.closed && "grayscale-[0.6]")}
          sizes="176px"
        />
        {avail.closed && (
          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 text-xs font-bold text-white">
            {hit.opensAtLabel ? `Opens ${hit.opensAtLabel}` : "Closed"}
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-sm font-medium text-kd-fg">{r.name}</p>
      <div className="flex items-center gap-1.5 text-xs text-kd-fg-muted tabular-nums">
        {r.avgRating != null && (
          <span className="flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-kd-accent text-kd-accent" />
            {r.avgRating.toFixed(1)}
          </span>
        )}
        <span>
          · {hit.etaMinutes}–{hit.etaMinutes + 10} min
        </span>
      </div>
    </Link>
  );
}
