// Client cart (zustand, localStorage-persisted). Prices here are display estimates only —
// the server re-prices everything at quote/placeOrder time.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_UNAVAILABILITY_PREFERENCE,
  type UnavailabilityPreference,
} from "@fd/shared";

export type CartLine = {
  lineId: string;
  menuItemId: string;
  name: string;
  qty: number;
  unitPriceMinor: number; // base + modifier deltas (client estimate)
  modifierOptionIds: string[];
  modifierNames: string[];
  notes?: string;
  // "If this item is unavailable" preference (#39). Older persisted lines may
  // lack it, so readers must fall back to the default.
  unavailabilityPreference?: UnavailabilityPreference;
};

// Two lines are "the same product" (and so merge on add) when the item, its
// selected options, the note, and the unavailability preference all match.
function sameConfig(a: Omit<CartLine, "lineId">, b: CartLine): boolean {
  if (a.menuItemId !== b.menuItemId) return false;
  if ((a.notes ?? "") !== (b.notes ?? "")) return false;
  if (
    (a.unavailabilityPreference ?? DEFAULT_UNAVAILABILITY_PREFERENCE) !==
    (b.unavailabilityPreference ?? DEFAULT_UNAVAILABILITY_PREFERENCE)
  ) {
    return false;
  }
  const as = [...a.modifierOptionIds].sort();
  const bs = [...b.modifierOptionIds].sort();
  return as.length === bs.length && as.every((id, i) => id === bs[i]);
}

type CartState = {
  branchId: string | null;
  branchSlug: string | null;
  branchName: string | null;
  lines: CartLine[];
  addLine: (
    branch: { id: string; slug: string; name: string },
    line: Omit<CartLine, "lineId">,
  ) => "added" | "branch_conflict";
  // Replace an existing line's config in place (edit-from-cart round-trip, #39).
  // If the edit makes it identical to another line, the two merge.
  updateLine: (lineId: string, line: Omit<CartLine, "lineId">) => void;
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
        // Per-line duplicate merge: an identical config bumps qty instead of
        // creating a new line (#39).
        const dupe = s.lines.find((l) => sameConfig(line, l));
        const lines = dupe
          ? s.lines.map((l) => (l.lineId === dupe.lineId ? { ...l, qty: l.qty + line.qty } : l))
          : [...s.lines, { ...line, lineId: crypto.randomUUID() }];
        set({
          branchId: branch.id,
          branchSlug: branch.slug,
          branchName: branch.name,
          lines,
        });
        return "added";
      },
      updateLine: (lineId, line) =>
        set((s) => {
          // Apply the edit, then fold into any pre-existing identical line.
          const edited = s.lines.map((l) => (l.lineId === lineId ? { ...line, lineId } : l));
          const target = edited.find((l) => l.lineId === lineId)!;
          const twin = edited.find((l) => l.lineId !== lineId && sameConfig(line, l));
          if (!twin) return { lines: edited };
          return {
            lines: edited
              .filter((l) => l.lineId !== lineId)
              .map((l) => (l.lineId === twin.lineId ? { ...l, qty: l.qty + target.qty } : l)),
          };
        }),
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
