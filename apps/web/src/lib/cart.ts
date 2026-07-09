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
