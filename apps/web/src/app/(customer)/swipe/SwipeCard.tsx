"use client";

// A single card in the swipe deck: draggable (left=skip, right=add, up=details) and
// tap-to-flip for a "most popular" back face. Only the top card (depth 0) is
// interactive; depth 1/2 are decorative peeking cards behind it.
//
// Drag/flip outcomes are reported to the parent via onSwipeLeft/Right/Up + onFlip —
// this card never mutates cart/deck state itself. The parent decides what a swipe-right
// actually does (instant add / open modifier sheet / branch-conflict / closed toast) and
// drives the fly-off or snap-back animation back through the imperative handle, since
// that decision can require an async round-trip (the modifier sheet) before the card
// is allowed to leave the deck.
import { forwardRef, useImperativeHandle } from "react";
import { motion, useAnimate, useMotionValue, useTransform } from "framer-motion";
import { Clock, Sparkles, Star, Tag, Truck } from "lucide-react";
import { formatRs, priceBandDots } from "@fd/shared";
import { RestaurantImage } from "@/components/media/RestaurantImage";
import { restaurantCoverPlaceholder, itemImagePlaceholder } from "@/components/media/placeholders";
import { ItemImage } from "@/components/media/ItemImage";
import { usePriceDisplay } from "@/lib/price-display";
import { cn } from "@/lib/utils";
import { displayMinor, swipeAvailability, type SwipeHit } from "./types";

export type SwipeCardHandle = {
  /** Animate the card off-screen in `dir`, then resolve. Parent commits the add/skip after. */
  flyOff: (dir: "left" | "right") => Promise<void>;
  /** Spring the card back to center (a swipe that didn't commit, e.g. closed/conflict). */
  reset: () => void;
};

const DEPTH_TRANSFORM = [
  { y: 0, scale: 1, rotate: 0 },
  { y: -12, scale: 0.955, rotate: -2.5 },
  { y: -22, scale: 0.91, rotate: 2.5 },
] as const;

const SWIPE_THRESHOLD = 90;
const TAP_MAX_DIST = 6;

export const SwipeCard = forwardRef<
  SwipeCardHandle,
  {
    hit: SwipeHit;
    depth: 0 | 1 | 2;
    flipped: boolean;
    onFlip: () => void;
    onSwipeLeft: () => void;
    onSwipeRight: () => void;
    onSwipeUp: () => void;
  }
>(function SwipeCard({ hit, depth, flipped, onFlip, onSwipeLeft, onSwipeRight, onSwipeUp }, ref) {
  const [scope, animate] = useAnimate();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(1);
  const rotate = useTransform(x, [-220, 220], [-16, 16]);
  const addOpacity = useTransform(x, [15, 100], [0, 1]);
  const skipOpacity = useTransform(x, [-100, -15], [1, 0]);
  const upOpacity = useTransform(y, [-100, -15], [1, 0]);

  useImperativeHandle(ref, () => ({
    // Animate the bound motion values (not the DOM element): framer's element-form
    // animate() never resolves when the same transform channels are already driven by
    // motion values in `style`, so the awaiting caller would hang. `rotate` follows `x`
    // via the transform above, so tilting it comes for free.
    async flyOff(dir) {
      const dx = dir === "right" ? 650 : -650;
      await Promise.all([
        animate(x, dx, { duration: 0.3, ease: "easeOut" }),
        animate(opacity, 0, { duration: 0.3, ease: "easeOut" }),
      ]);
    },
    reset() {
      y.set(0);
      opacity.set(1);
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
    },
  }));

  const priceMode = usePriceDisplay((s) => s.mode);
  // Dish prices shown in the customer's tax-display mode so they agree with the menu page
  // and the server-priced checkout (#146). Fees/thresholds below stay raw.
  const disp = (minor: number) => formatRs(displayMinor(minor, hit.taxInfo, priceMode));

  const r = hit.restaurant;
  const avail = swipeAvailability(hit);
  const isNew = r.avgRating == null && !avail.closed;
  const showFree = hit.deliveryFeeMinor === 0 && !avail.closed;
  const showDeal = hit.deliveryFeeMinor !== 0 && !!r.dealBadge && !avail.closed;
  const band = priceBandDots(hit.priceBand);
  const featured = hit.popularItems[0];
  const top = depth === 0;
  const d = DEPTH_TRANSFORM[depth];

  return (
    <motion.div
      ref={scope}
      className="absolute inset-0 touch-none select-none"
      style={{
        x: top ? x : 0,
        y: top ? y : d.y,
        rotate: top ? rotate : d.rotate,
        opacity: top ? opacity : 1,
        scale: top ? 1 : d.scale,
        zIndex: 30 - depth * 10,
        cursor: top ? "grab" : "default",
        pointerEvents: top ? "auto" : "none",
      }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      drag={top}
      dragElastic={0.6}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        const dist = Math.hypot(info.offset.x, info.offset.y);
        if (dist < TAP_MAX_DIST) {
          x.set(0);
          y.set(0);
          onFlip();
          return;
        }
        const isUp =
          info.offset.y < -SWIPE_THRESHOLD && Math.abs(info.offset.y) > Math.abs(info.offset.x);
        if (isUp) {
          void animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
          void animate(y, 0, { type: "spring", stiffness: 300, damping: 30 });
          onSwipeUp();
          return;
        }
        if (info.offset.x > SWIPE_THRESHOLD) {
          onSwipeRight();
          return;
        }
        if (info.offset.x < -SWIPE_THRESHOLD) {
          onSwipeLeft();
          return;
        }
        void animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
        void animate(y, 0, { type: "spring", stiffness: 300, damping: 30 });
      }}
    >
      <div
        className="relative h-full w-full"
        style={{
          transformStyle: "preserve-3d",
          transition: "transform .5s cubic-bezier(.16,1,.3,1)",
          transform: `rotateY(${flipped && top ? 180 : 0}deg)`,
        }}
      >
        {/* FRONT */}
        <div
          className="absolute inset-0 overflow-hidden rounded-3xl shadow-xl"
          style={{ backfaceVisibility: "hidden" }}
        >
          <RestaurantImage
            photo={hit.photo}
            name={r.name}
            tint={r.primaryColor}
            fallbackSrc={restaurantCoverPlaceholder(r.cuisineTags)}
            className="h-full w-full"
          />
          <span className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/35 to-transparent" />
          <span className="absolute inset-x-0 bottom-0 h-[80%] bg-gradient-to-t from-black/90 via-black/60 to-transparent" />

          {showFree && (
            <span className="absolute left-3.5 top-3.5 flex items-center gap-1 rounded-full border border-white/35 bg-kd-success/50 px-2.5 py-1.5 text-xs font-bold text-white backdrop-blur-md">
              <Truck className="h-3.5 w-3.5" /> Free delivery
            </span>
          )}
          {showDeal && (
            <span className="absolute left-3.5 top-3.5 flex items-center gap-1 rounded-full border border-white/35 bg-kd-accent/50 px-2.5 py-1.5 text-xs font-extrabold text-white backdrop-blur-md">
              🎉 {r.dealBadge}
            </span>
          )}

          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4">
            {!avail.closed &&
              (r.avgRating != null ? (
                <span className="flex w-fit items-center gap-1 rounded-full border border-white/35 bg-white/20 px-2.5 py-1 text-xs font-bold text-white backdrop-blur-md">
                  <Star className="h-3 w-3 fill-kd-accent text-kd-accent" />
                  {r.avgRating.toFixed(1)}
                  <span className="font-medium text-white/70">
                    ({r.ratingCount.toLocaleString("en-US")})
                  </span>
                </span>
              ) : (
                isNew && (
                  <span className="flex w-fit items-center gap-1 rounded-full bg-kd-primary px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white">
                    <Sparkles className="h-3 w-3" /> New
                  </span>
                )
              ))}

            <h2 className="text-2xl font-bold leading-tight tracking-tight text-white [text-shadow:0_2px_14px_rgba(0,0,0,0.4)]">
              {r.name}
            </h2>

            <div className="flex flex-wrap gap-1.5">
              {r.cuisineTags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-1.5 text-sm tabular-nums text-white/85">
              <span className="flex items-center gap-1 font-semibold text-white">
                <Clock className="h-3.5 w-3.5" />
                {hit.etaMinutes}–{hit.etaMinutes + 10} min
              </span>
              <span className="text-white/45">·</span>
              <span>{(hit.distanceM / 1000).toFixed(1)} km</span>
              <span className="text-white/45">·</span>
              <span>
                <span className="font-bold text-white">Rs {band.filled}</span>
                <span className="text-white/45">{band.empty}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <span
                className={cn(
                  "font-semibold",
                  hit.deliveryFeeMinor === 0 ? "text-emerald-300" : "text-white/85",
                )}
              >
                {hit.deliveryFeeMinor === 0
                  ? "Free delivery"
                  : `${formatRs(hit.deliveryFeeMinor)} delivery`}
              </span>
              <span className="text-white/45">·</span>
              <span className="text-white/75">Min {formatRs(hit.minOrderMinor)}</span>
            </div>

            {featured && (
              <div className="mt-1 flex items-center gap-2.5 rounded-2xl border border-white/40 bg-white/20 p-2.5 backdrop-blur-xl">
                <ItemImage
                  url={featured.imageUrl}
                  name={featured.name}
                  fallbackSrc={itemImagePlaceholder(r.cuisineTags)}
                  className="h-9 w-9 rounded-lg"
                  sizes="36px"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-white/80">
                    Featured · swipe right to add
                  </p>
                  <p className="truncate text-sm font-bold text-white">{featured.name}</p>
                </div>
                <span className="text-sm font-extrabold tabular-nums text-white">
                  {disp(featured.priceMinor)}
                </span>
              </div>
            )}
            <p className="text-center text-[11px] text-white/55">
              Tap to flip · swipe up for details
            </p>
          </div>

          {avail.closed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
              <span className="rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-kd-fg shadow-lg">
                🌙 {avail.label}
              </span>
              <span className="text-sm font-semibold text-white/90">Swipe left — back later</span>
            </div>
          )}

          {top && (
            <>
              <motion.div
                style={{ opacity: addOpacity }}
                className="pointer-events-none absolute left-5 top-6 -rotate-[14deg] rounded-xl border-4 border-kd-success bg-white/90 px-3.5 py-1 text-2xl font-black tracking-wide text-kd-success"
              >
                ADD 🔥
              </motion.div>
              <motion.div
                style={{ opacity: skipOpacity }}
                className="pointer-events-none absolute right-5 top-6 rotate-[14deg] rounded-xl border-4 border-kd-danger bg-white/90 px-3.5 py-1 text-2xl font-black tracking-wide text-kd-danger"
              >
                SKIP
              </motion.div>
              <motion.div
                style={{ opacity: upOpacity }}
                className="pointer-events-none absolute bottom-[120px] left-1/2 -translate-x-1/2 rounded-xl border-4 border-kd-info bg-white/90 px-3.5 py-1 text-lg font-black tracking-wide text-kd-info"
              >
                DETAILS ↑
              </motion.div>
            </>
          )}
        </div>

        {/* BACK */}
        <div
          className="absolute inset-0 flex flex-col overflow-hidden rounded-3xl border border-kd-border bg-kd-surface p-4 shadow-xl"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            opacity: flipped && top ? 1 : 0,
            transition: `opacity .25s ${flipped ? ".12s" : "0s"}`,
          }}
        >
          <div className="flex items-center gap-2.5">
            <RestaurantImage
              photo={hit.photo}
              name={r.name}
              tint={r.primaryColor}
              fallbackSrc={restaurantCoverPlaceholder(r.cuisineTags)}
              className="h-11 w-11 shrink-0 rounded-xl"
              sizes="44px"
            />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-bold tracking-tight text-kd-fg">{r.name}</h3>
              <p className="truncate text-xs text-kd-fg-muted">{r.cuisineTags.join(" · ")}</p>
            </div>
          </div>
          <div className="my-3.5 h-px bg-kd-border" />
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-kd-fg-subtle">
            Most popular
          </p>
          <div className="flex flex-col gap-2">
            {hit.popularItems.slice(0, 3).map((item) => (
              <div key={item.id} className="flex items-center gap-2.5">
                <ItemImage
                  url={item.imageUrl}
                  name={item.name}
                  fallbackSrc={itemImagePlaceholder(r.cuisineTags)}
                  className="h-7 w-7 rounded-lg"
                  sizes="28px"
                />
                <span className="flex-1 truncate text-sm font-medium text-kd-fg">{item.name}</span>
                <span className="text-sm font-semibold tabular-nums text-kd-fg-muted">
                  {disp(item.priceMinor)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex flex-col gap-2 text-sm text-kd-fg-muted">
            {r.dealBadge && (
              <span className="flex items-center gap-2">
                <Tag className="h-3.5 w-3.5 text-kd-fg-subtle" /> {r.dealBadge}
              </span>
            )}
            <span className="truncate">{hit.addressText}</span>
            <span
              className={cn("font-semibold", avail.closed ? "text-kd-danger" : "text-kd-success")}
            >
              {avail.closed ? avail.label : "Open now"}
            </span>
          </div>
          <button
            type="button"
            onClick={onFlip}
            className="mt-3.5 w-full rounded-xl border border-kd-border bg-kd-surface-muted py-3 text-sm font-semibold text-kd-fg active:scale-[0.98]"
          >
            ↺ Flip back
          </button>
        </div>
      </div>
    </motion.div>
  );
});
