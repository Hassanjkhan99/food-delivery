"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Heart, Star, Tag } from "lucide-react";
import { formatRs, priceBandDots } from "@fd/shared";
import { RestaurantImage } from "@/components/media/RestaurantImage";
import { restaurantCoverPlaceholder } from "@/components/media/placeholders";
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
      className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full border border-kd-border bg-white/95 text-kd-fg-muted shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-kd-primary"
    >
      <Heart className={cn("h-[22px] w-[22px]", saved && "fill-kd-primary text-kd-primary")} />
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
            fallbackSrc={restaurantCoverPlaceholder(r.cuisineTags)}
            className={cn(
              "aspect-[16/10] w-full transition-transform duration-300 group-hover:scale-[1.03]",
              avail.closed && "grayscale-[0.6]",
            )}
            // Render the closed scrim INSIDE the image so the Google attribution stays
            // on top of it (ToS-required credit must not be hidden) — #36 review.
            overlay={
              avail.closed && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-kd-overlay text-center">
                  <span className="rounded-full bg-white/95 px-3 py-1.5 text-sm font-bold text-kd-fg">
                    {avail.label}
                  </span>
                  <span className="text-xs font-semibold text-white/90">Pre-order for later</span>
                </div>
              )
            }
          />

          {/* Promoted badge takes the top-left slot; else free-delivery. Promotions are
              always clearly labeled so paid placement is transparent (#22). */}
          {hit.promoted ? (
            <span className="absolute left-3 top-3 rounded-full bg-kd-primary px-2.5 py-1 text-xs font-bold uppercase leading-none tracking-wide text-white shadow-sm">
              Promoted
            </span>
          ) : (
            hit.deliveryFeeMinor === 0 &&
            !avail.closed && (
              <span className="absolute left-3 top-3 rounded-full bg-kd-success px-2.5 py-1 text-xs font-bold leading-none text-white shadow-sm">
                Free delivery
              </span>
            )
          )}

          <FavoriteButton />

          {!avail.closed && r.avgRating != null && (
            <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-xs font-bold text-kd-fg shadow-sm">
              <Star className="h-3 w-3 fill-kd-accent text-kd-accent" />
              {r.avgRating.toFixed(1)}
              <span className="font-medium text-kd-fg-muted">({r.ratingCount})</span>
            </span>
          )}
        </div>

        <div className="p-4">
          <h3 className="font-semibold leading-tight tracking-tight text-kd-fg">{r.name}</h3>

          {r.dealBadge && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-kd-accent-soft px-2 py-0.5 text-xs font-semibold text-kd-warning">
              <Tag className="h-3 w-3" />
              {r.dealBadge}
            </span>
          )}

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
            {hit.priceBand > 0 && (
              <>
                <span className="text-kd-fg-subtle">·</span>
                <span aria-label={`Price band ${hit.priceBand} of 3`} className="tracking-tight">
                  <span className="text-kd-fg-subtle">Rs </span>
                  <span className="font-semibold text-kd-fg">
                    {priceBandDots(hit.priceBand).filled}
                  </span>
                  <span className="text-kd-fg-subtle">{priceBandDots(hit.priceBand).empty}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}

/** Horizontal card (photo left, details right) — used for the "Top rated" rail so it
 *  matches the polished list layout. Shows a free-delivery pill, gold rating, ETA + min. */
export function RestaurantRowCard({ hit }: { hit: FeedHit }) {
  const r = hit.restaurant;
  const avail = availability(hit);
  return (
    <Link
      href={`/r/${r.slug}`}
      className="group relative flex items-center gap-5 rounded-[22px] border border-kd-border bg-kd-surface p-3 shadow-[0_8px_20px_rgba(0,0,0,0.05)] transition-all hover:-translate-y-1.5 hover:shadow-[0_18px_36px_rgba(0,0,0,0.12)]"
    >
      <RestaurantImage
        photo={hit.photo}
        name={r.name}
        tint={r.primaryColor}
        fallbackSrc={restaurantCoverPlaceholder(r.cuisineTags)}
        className={cn(
          "h-32 w-32 shrink-0 rounded-[18px] sm:h-40 sm:w-40",
          avail.closed && "grayscale-[0.6]",
        )}
        sizes="160px"
      />
      <div className="min-w-0 flex-1 py-0.5 pr-8">
        {hit.deliveryFeeMinor === 0 && !avail.closed && (
          <span className="inline-flex h-7 items-center rounded-full bg-kd-success-soft px-2.5 text-sm font-semibold text-kd-success">
            Free delivery
          </span>
        )}
        <p className="mt-1.5 truncate text-xl font-semibold text-kd-fg sm:text-2xl">{r.name}</p>
        {r.avgRating != null && (
          <div className="mt-1 flex items-center gap-1 text-base tabular-nums">
            <Star className="h-[18px] w-[18px] fill-kd-accent text-kd-accent" />
            <span className="font-semibold text-kd-accent">{r.avgRating.toFixed(1)}</span>
            <span className="text-kd-fg-muted">({r.ratingCount})</span>
          </div>
        )}
        <p className="mt-1 truncate text-base text-kd-fg-muted tabular-nums">
          {avail.closed ? (
            <span className="font-semibold text-kd-danger">{avail.label}</span>
          ) : (
            <>
              {hit.etaMinutes}–{hit.etaMinutes + 10} min · Min {formatRs(hit.minOrderMinor)}
            </>
          )}
        </p>
      </div>
      <FavoriteButton />
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
          fallbackSrc={restaurantCoverPlaceholder(r.cuisineTags)}
          className={cn("aspect-[16/10] w-44 rounded-xl", avail.closed && "grayscale-[0.6]")}
          sizes="176px"
          // Scrim inside the image so the Google attribution stays visible — #36 review.
          // Use the shared availability label so the paused state ("Temporarily paused")
          // shows here too, matching the full card instead of always saying "Closed". — #36
          // review round 2.
          overlay={
            avail.closed && (
              <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-kd-overlay px-2 text-center text-xs font-bold text-white">
                {avail.label ?? "Closed"}
              </span>
            )
          }
        />
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
