// Client cart (zustand, localStorage-persisted). Prices here are display estimates only —
// the server re-prices everything at quote/placeOrder time.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartLine = {
  lineId: string;
  menuItemId: string;
  name: string;
  qty: number;
  unitPriceMinor: number; // base + modifier deltas (client estimate)
  modifierOptionIds: string[];
  modifierNames: string[];
  notes?: string;
};

type CartState = {
  branchId: string | null;
  branchSlug: string | null;
  branchName: string | null;
  lines: CartLine[];
  addLine: (
    branch: { id: string; slug: string; name: string },
    line: Omit<CartLine, "lineId">,
  ) => "added" | "branch_conflict";
  removeLine: (lineId: string) => void;
  setQty: (lineId: string, qty: number) => void;
  clear: () => void;
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      branchId: null,
      branchSlug: null,
      branchName: null,
      lines: [],
      addLine: (branch, line) => {
        const s = get();
        if (s.branchId && s.branchId !== branch.id && s.lines.length > 0) {
          return "branch_conflict";
        }
        set({
          branchId: branch.id,
          branchSlug: branch.slug,
          branchName: branch.name,
          lines: [...s.lines, { ...line, lineId: crypto.randomUUID() }],
        });
        return "added";
      },
      removeLine: (lineId) =>
        set((s) => {
          const lines = s.lines.filter((l) => l.lineId !== lineId);
          return lines.length === 0
            ? { lines, branchId: null, branchSlug: null, branchName: null }
            : { lines };
        }),
      setQty: (lineId, qty) =>
        set((s) => ({
          lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, qty) } : l)),
        })),
      clear: () => set({ branchId: null, branchSlug: null, branchName: null, lines: [] }),
    }),
    { name: "fd-cart" },
  ),
);

export const cartSubtotal = (lines: CartLine[]) =>
  lines.reduce((s, l) => s + l.unitPriceMinor * l.qty, 0);

// ── Cart extras (tip + cutlery) ─────────────────────────────────────────────
// Persisted separately from the item cart (`fd-cart`) so they survive navigation
// to /checkout, where the checkout page reads this store and threads
// tipAmount + cutleryRequested into quoteCart(QuoteCartInput) and
// placeOrder(PlaceOrderInput). The API folds tip into grandTotalMinor
// (untaxed/uncommissioned); cutleryRequested defaults true.
type CartExtras = {
  tipAmount: number; // minor units (paisa)
  cutleryRequested: boolean;
  setTip: (minor: number) => void;
  setCutlery: (on: boolean) => void;
  reset: () => void;
};

export const useCartExtras = create<CartExtras>()(
  persist(
    (set) => ({
      tipAmount: 0,
      cutleryRequested: true,
      setTip: (minor) => set({ tipAmount: Math.max(0, Math.round(minor)) }),
      setCutlery: (on) => set({ cutleryRequested: on }),
      reset: () => set({ tipAmount: 0, cutleryRequested: true }),
    }),
    { name: "fd-cart-extras" },
  ),
);

// ── Reorder ───────────────────────────────────────────────────────────────
// Rebuild the cart from a past order's item snapshots (menuSnapshotJson). Prices
// and modifier names come straight from the snapshot as display estimates — the
// server re-prices and re-validates availability at quote/placeOrder time, so a
// stale price or a since-removed item/option surfaces there, not here.

/** Shape of a single order item's menuSnapshotJson, mirrored from orderService. */
export type OrderItemSnapshot = {
  qty: number;
  notes?: string | null;
  menuSnapshotJson: {
    menuItemId?: string;
    name?: string;
    unitPriceMinor?: number;
    // Seeded/older snapshots store the display price under `priceMinor`.
    priceMinor?: number;
    modifiers?: Array<{ optionId?: string; optionName?: string }>;
  };
};

// Order statuses that reached a terminal state where offering a one-tap reorder
// makes sense. Both the orders list and the order detail page gate on this so an
// in-flight order can't be turned into a duplicate before it's fulfilled.
export const REORDERABLE_STATUSES = new Set([
  "delivered",
  "cancelled",
  "rejected",
  "auto_expired",
]);

/** A past order reduced to what reorder needs: the branch and its item snapshots. */
export type ReorderSource = {
  branch: { id: string; slug: string; name: string };
  items: OrderItemSnapshot[];
};

export type ReorderResult = "reordered" | "empty" | "invalid";

/**
 * Replace the cart with the items from a past order. Reorder always starts a
 * fresh cart (any conflicting in-progress cart from another branch is cleared),
 * matching the "one tap, back to this order" expectation. Returns "empty" when
 * no snapshot line could be reconstructed (all items lacked an id).
 */
export function reorderIntoCart(source: ReorderSource): ReorderResult {
  if (!source.branch?.id) return "invalid";

  const lines: CartLine[] = [];
  for (const it of source.items) {
    const snap = it.menuSnapshotJson ?? {};
    if (!snap.menuItemId) continue; // can't re-add an item we can't identify
    const modifiers = snap.modifiers ?? [];
    lines.push({
      lineId: crypto.randomUUID(),
      menuItemId: snap.menuItemId,
      name: snap.name ?? "Item",
      qty: Math.max(1, it.qty),
      unitPriceMinor: snap.unitPriceMinor ?? snap.priceMinor ?? 0,
      modifierOptionIds: modifiers.map((m) => m.optionId).filter((id): id is string => !!id),
      modifierNames: modifiers.map((m) => m.optionName).filter((n): n is string => !!n),
      notes: it.notes ?? undefined,
    });
  }

  if (lines.length === 0) return "empty";

  useCart.setState({
    branchId: source.branch.id,
    branchSlug: source.branch.slug,
    branchName: source.branch.name,
    lines,
  });
  // Reorder starts a fresh cart, so drop any tip/cutlery override carried over
  // from a previous cart — otherwise a stale custom tip is silently reapplied at
  // checkout despite the "cleared and started fresh" messaging.
  useCartExtras.getState().reset();
  return "reordered";
}
