"use client";

// The single highest-leverage conversion pattern: a cart bar that springs up the
// moment the first item lands in the cart, following the user down the menu. Themed
// with the restaurant's --brand-primary (inherited from the page container). Only
// shows for *this* branch's cart so it never advertises a stale other-restaurant cart.
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import { formatRs } from "@fd/shared";
import { cartSubtotal, useCart } from "@/lib/cart";

export function FloatingCartBar({ branchId }: { branchId: string }) {
  const reduced = useReducedMotion();
  const lines = useCart((s) => s.lines);
  const cartBranchId = useCart((s) => s.branchId);

  const show = cartBranchId === branchId && lines.length > 0;
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = cartSubtotal(lines);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={reduced ? { opacity: 0 } : { y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: 96, opacity: 0 }}
          transition={
            reduced ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 32 }
          }
          className="fixed inset-x-0 bottom-4 z-50 mx-auto w-full max-w-md px-4"
        >
          <Link
            href="/cart"
            aria-label={`View cart, ${count} ${count === 1 ? "item" : "items"}, ${formatRs(subtotal)}`}
            className="flex items-center justify-between gap-3 rounded-2xl px-5 py-3.5 text-sm font-semibold text-white shadow-xl shadow-black/25 transition active:scale-[0.99]"
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            <span className="flex items-center gap-2.5">
              <span className="relative flex items-center">
                <ShoppingBag className="h-5 w-5" />
                <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-neutral-900">
                  {count}
                </span>
              </span>
              View cart
            </span>
            <span className="tabular-nums">{formatRs(subtotal)}</span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
