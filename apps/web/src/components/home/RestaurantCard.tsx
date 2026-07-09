"use client";

import Link from "next/link";
import { Star, Timer } from "lucide-react";
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

function Rating({ hit }: { hit: FeedHit }) {
  if (hit.restaurant.avgRating == null) return null;
  return (
    <span className="flex items-center gap-1 font-medium text-neutral-700">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      {hit.restaurant.avgRating.toFixed(1)}
      <span className="font-normal text-neutral-400">({hit.restaurant.ratingCount})</span>
    </span>
  );
}

function DeliveryFee({ minor }: { minor: number }) {
  if (minor === 0) {
    return <span className="font-semibold text-emerald-600">Free delivery</span>;
  }
  return <span>{formatRs(minor)} delivery</span>;
}

/** Full-width rich card for the main vertical feed. */
export function RestaurantCard({ hit }: { hit: FeedHit }) {
  const r = hit.restaurant;
  const avail = availability(hit);

  return (
    <Link href={`/r/${r.slug}`} className="group block">
      <article className="h-full overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-shadow hover:shadow-md">
        <div className="relative">
          <RestaurantImage
            photo={hit.photo}
            name={r.name}
            tint={r.primaryColor}
            className={cn(
              "h-36 w-full transition-transform duration-300 group-hover:scale-[1.03]",
              avail.closed && "grayscale-[0.5]",
            )}
          />
          {hit.deliveryFeeMinor === 0 && !avail.closed && (
            <span className="absolute left-3 top-3 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white shadow-sm">
              Free delivery
            </span>
          )}
          {avail.closed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-center">
              <span className="rounded-full bg-white/95 px-3 py-1 text-sm font-semibold text-neutral-900">
                {avail.label}
              </span>
              <span className="text-xs font-medium text-white/85">Pre-order for later</span>
            </div>
          )}
        </div>

        <div className="space-y-1.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight text-neutral-900">{r.name}</h3>
            <Rating hit={hit} />
          </div>

          {r.cuisineTags.length > 0 && (
            <p className="truncate text-xs text-neutral-500">{r.cuisineTags.join(" · ")}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-xs text-neutral-600">
            <span className="flex items-center gap-1">
              <Timer className="h-3.5 w-3.5" /> {hit.etaMinutes}–{hit.etaMinutes + 10} min
            </span>
            <span className="text-neutral-300">·</span>
            <DeliveryFee minor={hit.deliveryFeeMinor} />
            <span className="text-neutral-300">·</span>
            <span>{(hit.distanceM / 1000).toFixed(1)} km</span>
            <span className="text-neutral-300">·</span>
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
          className={cn("h-24 w-44 rounded-xl", avail.closed && "grayscale-[0.5]")}
          sizes="176px"
        />
        {avail.closed && (
          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 text-xs font-semibold text-white">
            {hit.opensAtLabel ? `Opens ${hit.opensAtLabel}` : "Closed"}
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-sm font-medium text-neutral-900">{r.name}</p>
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        {r.avgRating != null && (
          <span className="flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
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
