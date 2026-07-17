"use client";

// Gamified cart bar for the deck: a progress meter toward the active branch's minimum
// order (the only real per-branch threshold in the schema — there's no "spend X more
// for free delivery" field on Branch, so unlike the design prototype we don't invent one).
// Tapping hands off to the real /cart page rather than re-implementing checkout math here.
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import { formatRs } from "@fd/shared";
import { cartSubtotal, useCart } from "@/lib/cart";
import type { SwipeHit } from "./types";

export function SwipeCartBar({ hits }: { hits: SwipeHit[] }) {
  const reduced = useReducedMotion();
  const lines = useCart((s) => s.lines);
  const branchId = useCart((s) => s.branchId);
  const branchName = useCart((s) => s.branchName);
  const show = lines.length > 0 && !!branchId;
  const hit = hits.find((h) => h.branchId === branchId);

  const subtotal = cartSubtotal(lines);
  const min = hit?.minOrderMinor ?? 0;
  const fee = hit?.deliveryFeeMinor ?? 0;
  const met = subtotal >= min;
  const pct = min > 0 ? Math.min(1, subtotal / min) : 1;
  const label = met
    ? fee === 0
      ? "Free delivery included 🛵"
      : "Minimum reached — ready to checkout"
    : `Add ${formatRs(min - subtotal)} to reach the minimum order`;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={reduced ? { opacity: 0 } : { y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: 60, opacity: 0 }}
          transition={
            reduced ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 32 }
          }
          className="pointer-events-auto"
        >
          <Link
            href="/cart"
            className="block rounded-2xl bg-kd-fg px-3.5 py-3 shadow-xl active:scale-[0.99]"
          >
            <div className="flex items-center gap-2.5">
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10">
                <ShoppingBag className="h-5 w-5 text-white" />
                <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-kd-fg bg-kd-primary px-1 text-[11px] font-extrabold text-white">
                  {lines.reduce((n, l) => n + l.qty, 0)}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{branchName}</p>
                <p className="truncate text-xs text-white/60">{label}</p>
              </div>
              <span className="text-base font-extrabold tabular-nums text-white">
                {formatRs(subtotal)}
              </span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full transition-[width] duration-400"
                style={{
                  width: `${pct * 100}%`,
                  backgroundColor: met ? "var(--kd-success)" : "var(--kd-accent)",
                }}
              />
            </div>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
