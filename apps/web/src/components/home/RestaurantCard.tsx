"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Flame, Heart, MapPin, Star, Tag } from "lucide-react";
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
function FavoriteButton({ className }: { className?: string }) {
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
      className={cn(
        "kd-glass grid h-9 w-9 place-items-center rounded-full text-white/90 transition-transform active:scale-90",
        className,
      )}
    >
      <Heart className={cn("h-[18px] w-[18px]", saved && "fill-[#fb7185] text-[#fb7185]")} />
    </button>
  );
}

/** Solid brand pill for the top-left merchandising stack (promoted / deal / free delivery).
 *  Solid — not glass — so paid placement + offers stay unmistakable over any hero photo. */
function BadgePill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold leading-none shadow-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}

function DeliveryFee({ minor }: { minor: number }) {
  if (minor === 0) return <span className="font-semibold text-kd-success">Free delivery</span>;
  return <span>{formatRs(minor)} delivery</span>;
}

/** Decorative gradient + brand-tinted top/bottom scrims for the full-bleed hero. Passed
 *  through RestaurantImage's `overlay` so it renders BELOW the ToS-required Google
 *  attribution (which the component paints last, on top). */
function HeroScrims({ closed, label }: { closed: boolean; label: string | null }) {
  return (
    <>
      {/* top scrim — keeps the badge stack + heart legible over bright photos */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-24"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.34), transparent)" }}
      />
      {/* bottom scrim — the content well */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[82%]"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.94) 8%, rgba(0,0,0,0.72) 32%, rgba(0,0,0,0.22) 64%, transparent)",
        }}
      />
      {closed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[rgba(18,14,10,0.6)] text-center">
          <span className="kd-glass-solid rounded-full px-3.5 py-1.5 text-sm font-bold text-kd-fg">
            {label}
          </span>
          <span className="text-xs font-semibold text-white/90">Pre-order for later</span>
        </div>
      )}
    </>
  );
}

/** Full-bleed liquid-glass card for the main vertical feed. Hero photo fills the whole
 *  card; all detail sits on glass chips over a bottom scrim. */
export function RestaurantCard({ hit }: { hit: FeedHit }) {
  const r = hit.restaurant;
  const avail = availability(hit);
  const dots = hit.priceBand > 0 ? priceBandDots(hit.priceBand) : null;

  return (
    <Link href={`/r/${r.slug}`} className="group block">
      <article className="relative aspect-[3/4] overflow-hidden rounded-[20px] border border-white/10 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
        <div className="absolute inset-0">
          <RestaurantImage
            photo={hit.photo}
            name={r.name}
            tint={r.primaryColor}
            fallbackSrc={restaurantCoverPlaceholder(r.cuisineTags)}
            className={cn(
              "h-full w-full transition-transform duration-300 group-hover:scale-[1.04]",
              avail.closed && "grayscale-[0.6]",
            )}
            overlay={<HeroScrims closed={avail.closed} label={avail.label} />}
          />
        </div>

        {/* Top-left merchandising stack — promoted sits above deal above free-delivery. */}
        <div className="absolute left-3 top-3 z-20 flex flex-col items-start gap-1.5">
          {hit.promoted && (
            <BadgePill className="bg-kd-primary uppercase tracking-wide text-white">
              Promoted
            </BadgePill>
          )}
          {r.dealBadge && (
            <BadgePill className="bg-kd-accent text-[#3d2f05]">
              <Tag className="h-3 w-3" />
              {r.dealBadge}
            </BadgePill>
          )}
          {hit.deliveryFeeMinor === 0 && !avail.closed && (
            <BadgePill className="bg-kd-success text-white">Free delivery</BadgePill>
          )}
        </div>

        <FavoriteButton className="absolute right-3 top-3 z-20" />

        {/* Bottom content well. Kept minimal when closed (name + area only). */}
        <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 p-4 text-white">
          {!avail.closed && r.avgRating != null && (
            <span className="kd-glass inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold text-white">
              <Star className="h-3 w-3 fill-kd-accent text-kd-accent" />
              {r.avgRating.toFixed(1)}
              <span className="font-medium text-white/70">({r.ratingCount})</span>
            </span>
          )}

          <div className="flex items-center gap-2">
            {r.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.logoUrl}
                alt=""
                className="kd-glass h-6 w-6 shrink-0 rounded-full object-cover p-px"
              />
            )}
            <h3
              className="truncate text-[1.32rem] font-bold leading-tight tracking-tight"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}
            >
              {r.name}
            </h3>
          </div>

          {hit.addressText && (
            <p className="flex items-center gap-1 truncate text-xs text-white/80">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{hit.addressText}</span>
            </p>
          )}

          {!avail.closed && (
            <>
              {r.cuisineTags.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {r.cuisineTags.slice(0, 3).map((c) => (
                    <span
                      key={c}
                      className="kd-glass whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium text-white/90"
                    >
                      {c}
                    </span>
                  ))}
                  {r.cuisineTags.length > 3 && (
                    <span className="whitespace-nowrap text-xs text-white/70">
                      +{r.cuisineTags.length - 3}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-sm tabular-nums text-white/90">
                <span className="flex items-center gap-1 font-semibold">
                  <Clock className="h-3.5 w-3.5" /> {hit.etaMinutes}–{hit.etaMinutes + 10} min
                </span>
                <span className="text-white/50">·</span>
                <span>{(hit.distanceM / 1000).toFixed(1)} km</span>
                {dots && (
                  <>
                    <span className="text-white/50">·</span>
                    <span aria-label={`Price band ${hit.priceBand} of 3`}>
                      <span className="text-white/60">Rs</span> {dots.filled}
                      <span className="text-white/40">{dots.empty}</span>
                    </span>
                  </>
                )}
                <span className="text-white/50">·</span>
                <span className="truncate">
                  <DeliveryFee minor={hit.deliveryFeeMinor} />
                </span>
                <span className="text-white/50">·</span>
                <span>Min {formatRs(hit.minOrderMinor)}</span>
              </div>

              {hit.prepBufferMinutes > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(217,119,6,0.85)] px-2 py-0.5 text-xs font-semibold text-white">
                  <Flame className="h-3 w-3" /> Kitchen&apos;s busy · +{hit.prepBufferMinutes} min
                </span>
              )}
            </>
          )}
        </div>
      </article>
    </Link>
  );
}

/** Horizontal glass row — used for the "Top rated" grid. Photo left, details right, on a
 *  light glass sheet that sits on the page background (lighter touch than the hero card). */
export function RestaurantRowCard({ hit }: { hit: FeedHit }) {
  const r = hit.restaurant;
  const avail = availability(hit);
  return (
    <Link
      href={`/r/${r.slug}`}
      className="kd-glass-sheet group relative flex items-center gap-4 rounded-2xl p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
    >
      <RestaurantImage
        photo={hit.photo}
        name={r.name}
        tint={r.primaryColor}
        fallbackSrc={restaurantCoverPlaceholder(r.cuisineTags)}
        className={cn("h-28 w-28 shrink-0 rounded-[16px]", avail.closed && "grayscale-[0.6]")}
        sizes="112px"
        overlay={
          avail.closed && (
            <span className="absolute inset-0 flex items-center justify-center rounded-[16px] bg-kd-overlay px-2 text-center text-xs font-bold text-white">
              {avail.label ?? "Closed"}
            </span>
          )
        }
      />
      <div className="min-w-0 flex-1 pr-8">
        {hit.deliveryFeeMinor === 0 && !avail.closed && (
          <span className="inline-flex h-6 items-center rounded-full bg-kd-success-soft px-2 text-xs font-semibold text-kd-success">
            Free delivery
          </span>
        )}
        <p className="mt-1 flex items-center gap-1.5 truncate text-lg font-semibold text-kd-fg">
          {r.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.logoUrl} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
          )}
          <span className="truncate">{r.name}</span>
        </p>
        {r.avgRating != null && (
          <div className="mt-0.5 flex items-center gap-1 text-sm tabular-nums">
            <Star className="h-4 w-4 fill-kd-accent text-kd-accent" />
            <span className="font-semibold text-kd-accent">{r.avgRating.toFixed(1)}</span>
            <span className="text-kd-fg-muted">({r.ratingCount})</span>
          </div>
        )}
        {hit.addressText && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-kd-fg-muted">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{hit.addressText}</span>
          </p>
        )}
        <p className="mt-0.5 truncate text-sm text-kd-fg-muted tabular-nums">
          {avail.closed ? (
            <span className="font-semibold text-kd-danger">{avail.label}</span>
          ) : (
            <>
              {hit.etaMinutes}–{hit.etaMinutes + 10} min · Min {formatRs(hit.minOrderMinor)}
            </>
          )}
        </p>
      </div>
      <FavoriteButton className="absolute right-3 top-3 border-kd-border !bg-white/70 !text-kd-fg-muted" />
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
          className={cn("aspect-[16/10] w-44 rounded-2xl", avail.closed && "grayscale-[0.6]")}
          sizes="176px"
          overlay={
            <>
              {hit.deliveryFeeMinor === 0 && !avail.closed && (
                <span className="absolute left-2 top-2 rounded-full bg-kd-success px-2 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
                  Free delivery
                </span>
              )}
              {!avail.closed && r.avgRating != null && (
                <span className="kd-glass absolute bottom-2 left-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white">
                  <Star className="h-3 w-3 fill-kd-accent text-kd-accent" />
                  {r.avgRating.toFixed(1)}
                </span>
              )}
              {avail.closed && (
                <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-kd-overlay px-2 text-center text-xs font-bold text-white">
                  {avail.label ?? "Closed"}
                </span>
              )}
            </>
          }
        />
      </div>
      <p className="mt-1.5 truncate text-sm font-medium text-kd-fg">{r.name}</p>
      <div className="flex items-center gap-1 truncate text-xs text-kd-fg-muted tabular-nums">
        <span>
          {hit.etaMinutes}–{hit.etaMinutes + 10} min
        </span>
        {hit.prepBufferMinutes > 0 && !avail.closed && (
          <>
            <span className="text-kd-fg-subtle">·</span>
            <span className="inline-flex items-center gap-0.5 font-semibold text-kd-warning">
              <Flame className="h-3 w-3" />
              busy
            </span>
          </>
        )}
      </div>
    </Link>
  );
}
