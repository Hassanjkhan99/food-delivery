"use client";

// Gamified swipe-to-order discovery: a Tinder-style card deck over the same
// browseBranches feed the home page uses. Right-swipe adds the branch's featured dish to
// the real cart (lib/cart.ts) — through the modifier sheet when the dish needs choices,
// through the conflict dialog when the cart already holds another restaurant's items —
// left-swipe skips, swipe-up opens a details sheet, and a tap flips the card to its
// "most popular" back face. Reimplemented from a Claude Designer prototype against the
// real schema + cart/location state.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "urql";
import { motion } from "framer-motion";
import { ChevronDown, Info, Menu, RotateCcw, ShoppingBag, X } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { useDeliveryLocation } from "@/lib/location";
import { useCart } from "@/lib/cart";
import { cn } from "@/lib/utils";
import { LocationGate } from "./LocationGate";
import { SwipeCard, type SwipeCardHandle } from "./SwipeCard";
import { QuickAddSheet, type QuickAddResult } from "./QuickAddSheet";
import { DetailsSheet } from "./DetailsSheet";
import { ConflictDialog } from "./ConflictDialog";
import { SwipeCartBar } from "./SwipeCartBar";
import type { SwipeHit, SwipeMenuItem } from "./types";

const SwipeDeckQuery = graphql(`
  query SwipeDeck($lat: Float!, $lng: Float!) {
    browseBranches(lat: $lat, lng: $lng) {
      distanceM
      etaMinutes
      priceBand
      branch {
        id
        addressText
        minOrderMinor
        deliveryFeeMinor
        isAcceptingOrders
        isOpenNow
        opensAtLabel
        photo {
          url
          source
          attributionHtml
        }
        popularItems(limit: 3) {
          id
          name
          description
          priceMinor
          compareAtPriceMinor
          isAvailable
          imageUrl
          badges
          modifierGroups {
            id
            name
            minSelect
            maxSelect
            options {
              id
              name
              priceDeltaMinor
              isAvailable
            }
          }
        }
        restaurant {
          id
          name
          slug
          avgRating
          ratingCount
          cuisineTags
          dealBadge
          theme {
            primaryColor
            accentColor
          }
        }
      }
    }
  }
`);

type ConfettiPiece = {
  id: number;
  left: number;
  tx: number;
  ty: number;
  rot: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
};
const CONFETTI_COLORS = ["#f97316", "#f59e0b", "#16a34a", "#dc2626", "#0284c7", "#fb923c"];

export default function SwipePage() {
  const loc = useDeliveryLocation();
  const [screen, setScreen] = useState<"gate" | "deck">("gate");

  const [{ data, fetching, error }] = useQuery({
    query: SwipeDeckQuery,
    variables: { lat: loc.lat, lng: loc.lng },
    pause: screen !== "deck",
  });

  const hits: SwipeHit[] =
    data?.browseBranches
      .filter((b) => b.branch.popularItems.length > 0)
      .map((b): SwipeHit => ({
        branchId: b.branch.id,
        branchSlug: b.branch.restaurant.slug,
        addressText: b.branch.addressText,
        distanceM: b.distanceM,
        etaMinutes: b.etaMinutes,
        priceBand: b.priceBand,
        minOrderMinor: b.branch.minOrderMinor,
        deliveryFeeMinor: b.branch.deliveryFeeMinor,
        isAcceptingOrders: b.branch.isAcceptingOrders,
        isOpenNow: b.branch.isOpenNow,
        opensAtLabel: b.branch.opensAtLabel ?? null,
        photo: b.branch.photo ?? null,
        restaurant: {
          id: b.branch.restaurant.id,
          name: b.branch.restaurant.name,
          slug: b.branch.restaurant.slug,
          avgRating: b.branch.restaurant.avgRating ?? null,
          ratingCount: b.branch.restaurant.ratingCount,
          cuisineTags: b.branch.restaurant.cuisineTags ?? [],
          dealBadge: b.branch.restaurant.dealBadge ?? null,
          primaryColor: b.branch.restaurant.theme?.primaryColor ?? null,
          accentColor: b.branch.restaurant.theme?.accentColor ?? null,
        },
        popularItems: b.branch.popularItems as SwipeMenuItem[],
      })) ?? [];

  const [idx, setIdx] = useState(0);
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const [modifierTarget, setModifierTarget] = useState<{
    hit: SwipeHit;
    item: SwipeMenuItem;
  } | null>(null);
  const [detailsHit, setDetailsHit] = useState<SwipeHit | null>(null);
  const [conflict, setConflict] = useState<{ hit: SwipeHit; item: SwipeMenuItem } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);

  const topCardRef = useRef<SwipeCardHandle>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const confettiTimer = useRef<number | undefined>(undefined);
  const confettiSeq = useRef(0);
  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(confettiTimer.current);
    },
    [],
  );

  const addLine = useCart((s) => s.addLine);
  const clearCart = useCart((s) => s.clear);
  const cartBranchName = useCart((s) => s.branchName);

  function flash(msg: string) {
    window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 1700);
  }

  function fireConfetti() {
    const pieces: ConfettiPiece[] = Array.from({ length: 20 }, () => {
      confettiSeq.current += 1;
      return {
        id: confettiSeq.current,
        left: 28 + Math.random() * 44,
        tx: (Math.random() * 2 - 1) * 150,
        ty: -(80 + Math.random() * 240),
        rot: (Math.random() * 2 - 1) * 540,
        size: 6 + Math.random() * 6,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!,
        delay: Math.random() * 0.08,
        duration: 0.8 + Math.random() * 0.5,
      };
    });
    setConfetti(pieces);
    window.clearTimeout(confettiTimer.current);
    confettiTimer.current = window.setTimeout(() => setConfetti([]), 1600);
  }

  function advance() {
    setIdx((i) => i + 1);
    setFlippedId(null);
  }

  async function commitAdd(
    hit: SwipeHit,
    item: SwipeMenuItem,
    modifierOptionIds: string[],
    modifierNames: string[],
    unitPriceMinor: number,
  ) {
    await topCardRef.current?.flyOff("right");
    const result = addLine(
      { id: hit.branchId, slug: hit.branchSlug, name: hit.restaurant.name },
      {
        menuItemId: item.id,
        name: item.name,
        qty: 1,
        unitPriceMinor,
        modifierOptionIds,
        modifierNames,
      },
    );
    if (result === "branch_conflict") {
      flash("Couldn't add — your cart has another restaurant's items.");
    } else {
      fireConfetti();
      flash(`Added · ${item.name}`);
    }
    advance();
  }

  function attemptAdd(hit: SwipeHit) {
    const item = hit.popularItems[0];
    const closed = !hit.isOpenNow || !hit.isAcceptingOrders;
    if (closed || !item) {
      flash(
        !hit.isOpenNow
          ? `🌙 Closed${hit.opensAtLabel ? ` · opens ${hit.opensAtLabel}` : ""}`
          : "Nothing available right now",
      );
      topCardRef.current?.reset();
      return;
    }
    const cart = useCart.getState();
    if (cart.branchId && cart.branchId !== hit.branchId && cart.lines.length > 0) {
      setConflict({ hit, item });
      topCardRef.current?.reset();
      return;
    }
    if (item.modifierGroups.length > 0) {
      setModifierTarget({ hit, item });
      topCardRef.current?.reset();
      return;
    }
    void commitAdd(hit, item, [], [], item.priceMinor);
  }

  async function skip() {
    await topCardRef.current?.flyOff("left");
    advance();
  }

  const top = hits[idx];
  const empty = idx >= hits.length && hits.length > 0;
  const stack = hits.slice(idx, idx + 3);

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100vh-72px)] bg-gradient-to-b from-kd-surface-muted to-kd-bg sm:-mx-6 lg:-mx-12">
      <div className="mx-auto max-w-md px-4 py-4">
        {screen === "gate" ? (
          <LocationGate onStart={() => setScreen("deck")} />
        ) : (
          <>
            {/* header */}
            <div className="flex items-center gap-2 pb-2">
              <button
                type="button"
                onClick={() => setScreen("gate")}
                className="flex min-w-0 items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center text-kd-primary">📍</span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-kd-fg-subtle">
                    Deliver to
                  </span>
                  <span className="flex items-center gap-0.5 truncate text-sm font-bold text-kd-fg">
                    {loc.label}
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  </span>
                </span>
              </button>
              <div className="flex-1" />
              <Link
                href="/"
                aria-label="Browse the full list instead"
                className="grid h-10 w-10 place-items-center rounded-full border border-kd-border bg-kd-surface shadow-sm"
              >
                <Menu className="h-[18px] w-[18px] text-kd-fg" />
              </Link>
            </div>

            {/* mode toggle */}
            <div className="flex items-center gap-2 pb-2">
              <div className="inline-flex gap-0.5 rounded-full bg-kd-surface-muted p-[3px]">
                <span className="flex items-center gap-1 rounded-full bg-kd-surface px-3.5 py-1.5 text-sm font-bold text-kd-primary shadow-sm">
                  🍽️ Restaurants
                </span>
                <span
                  title="Dish-first swiping is coming soon"
                  className="rounded-full px-3.5 py-1.5 text-sm font-semibold text-kd-fg-subtle"
                >
                  Dishes
                </span>
              </div>
              <div className="flex-1" />
              <span className="text-xs font-semibold tabular-nums text-kd-fg-muted">
                {Math.max(0, hits.length - idx)} nearby
              </span>
            </div>

            {/* deck */}
            <div className="relative mt-1 aspect-[3/4.35] w-full">
              {fetching && !data && (
                <div className="absolute inset-0 animate-pulse rounded-3xl bg-kd-surface-muted" />
              )}

              {error && !data && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl border border-kd-danger-soft bg-kd-danger-soft p-6 text-center">
                  <p className="text-sm text-kd-danger">Couldn&apos;t load nearby restaurants.</p>
                </div>
              )}

              {data && hits.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-3xl border border-kd-border bg-kd-surface p-6 text-center">
                  <div className="text-4xl">🔍</div>
                  <p className="mt-2 text-sm font-semibold text-kd-fg">
                    No restaurants deliver here yet
                  </p>
                  <Link
                    href="/"
                    className="mt-3 text-sm font-semibold text-kd-primary hover:underline"
                  >
                    Back to browse
                  </Link>
                </div>
              )}

              {empty && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-3xl border border-kd-border bg-kd-surface p-6 text-center">
                  <div className="mb-1 text-5xl">🍽️</div>
                  <h2 className="text-lg font-bold tracking-tight text-kd-fg">
                    That&apos;s every kitchen nearby
                  </h2>
                  <p className="mt-1.5 max-w-[250px] text-sm text-kd-fg-muted">
                    You&apos;ve swiped through all {hits.length} open spots in range.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIdx(0)}
                    className="mt-4 flex w-full max-w-[240px] items-center justify-center gap-2 rounded-2xl bg-kd-primary py-3.5 text-sm font-bold text-white shadow-md active:scale-[0.98]"
                  >
                    <RotateCcw className="h-4 w-4" /> Reshuffle the deck
                  </button>
                  <Link
                    href="/"
                    className="mt-2.5 w-full max-w-[240px] rounded-2xl border border-kd-border py-3.5 text-center text-sm font-semibold text-kd-fg"
                  >
                    Browse the full list instead
                  </Link>
                </div>
              )}

              {stack.map((hit, depth) => (
                <SwipeCard
                  key={hit.branchId}
                  ref={depth === 0 ? topCardRef : undefined}
                  hit={hit}
                  depth={depth as 0 | 1 | 2}
                  flipped={flippedId === hit.branchId}
                  onFlip={() => setFlippedId((id) => (id === hit.branchId ? null : hit.branchId))}
                  onSwipeLeft={() => void skip()}
                  onSwipeRight={() => attemptAdd(hit)}
                  onSwipeUp={() => setDetailsHit(hit)}
                />
              ))}
            </div>

            {/* action buttons */}
            {top && !empty && (
              <div className="flex items-center justify-center gap-4 py-3">
                <button
                  type="button"
                  onClick={() => void skip()}
                  aria-label="Skip"
                  className="grid h-14 w-14 place-items-center rounded-full border border-kd-border bg-kd-surface text-kd-danger shadow-md active:scale-[0.88]"
                >
                  <X className="h-6 w-6" strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsHit(top)}
                  aria-label="Details"
                  className="grid h-11 w-11 place-items-center rounded-full border border-kd-border bg-kd-surface text-kd-info shadow-sm active:scale-[0.88]"
                >
                  <Info className="h-5 w-5" strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  onClick={() => attemptAdd(top)}
                  aria-label="Add to cart"
                  className="grid h-16 w-16 place-items-center rounded-full bg-kd-primary text-white shadow-[0_8px_20px_rgba(249,115,22,0.42)] active:scale-[0.88]"
                >
                  <ShoppingBag className="h-7 w-7" strokeWidth={2.2} />
                </button>
              </div>
            )}

            <div className="sticky bottom-3 z-40 pt-1">
              <SwipeCartBar hits={hits} />
            </div>
          </>
        )}
      </div>

      {/* overlays */}
      <QuickAddSheet
        item={modifierTarget?.item ?? null}
        cuisineTags={modifierTarget?.hit.restaurant.cuisineTags ?? []}
        onClose={() => setModifierTarget(null)}
        onConfirm={(result: QuickAddResult) => {
          const target = modifierTarget;
          setModifierTarget(null);
          if (!target) return;
          void commitAdd(
            target.hit,
            target.item,
            result.modifierOptionIds,
            result.modifierNames,
            result.unitPriceMinor,
          );
        }}
      />

      <DetailsSheet
        hit={detailsHit}
        onClose={() => setDetailsHit(null)}
        onAdd={() => {
          const hit = detailsHit;
          setDetailsHit(null);
          if (hit) attemptAdd(hit);
        }}
      />

      <ConflictDialog
        existingName={cartBranchName}
        newName={conflict?.hit.restaurant.name ?? null}
        onConfirm={() => {
          const target = conflict;
          setConflict(null);
          if (!target) return;
          clearCart();
          if (target.item.modifierGroups.length > 0) {
            setModifierTarget(target);
          } else {
            void commitAdd(target.hit, target.item, [], [], target.item.priceMinor);
          }
        }}
        onCancel={() => setConflict(null)}
      />

      <div className="pointer-events-none fixed inset-0 z-[95] overflow-hidden">
        {confetti.map((p) => (
          <motion.span
            key={p.id}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x: p.tx, y: p.ty, opacity: 0, rotate: p.rot }}
            transition={{ duration: p.duration, delay: p.delay, ease: [0.2, 0.6, 0.4, 1] }}
            style={{
              position: "absolute",
              left: `${p.left}%`,
              bottom: 96,
              width: p.size,
              height: p.size,
              background: p.color,
              borderRadius: 2,
            }}
          />
        ))}
      </div>

      {toast && (
        <div
          className={cn(
            "fixed bottom-7 left-1/2 z-[120] -translate-x-1/2 whitespace-nowrap rounded-full bg-kd-fg px-4.5 py-2.5 text-sm font-semibold text-white shadow-xl",
          )}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
