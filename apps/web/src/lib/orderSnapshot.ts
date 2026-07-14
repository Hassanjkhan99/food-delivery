// Shared helpers for reading a frozen OrderItem.menuSnapshotJson across the order
// views (restaurant board, rider job, customer order). Combo lines (#53) freeze a
// component list so a generically-named deal (e.g. "Family Deal") can still be
// expanded to the dishes to prepare/hand over on every fulfilment surface (#114).

export type ComboComponentSnap = { menuItemId?: string; name: string; qty: number };

export type MenuItemSnapshot = {
  kind?: "combo" | "item";
  name?: string;
  components?: ComboComponentSnap[];
  unavailabilityPreference?: string;
  modifiers?: Array<{ optionName: string }>;
};

/**
 * Returns the frozen combo components for a line, or [] for a plain menu item.
 * Defensive against malformed/legacy snapshots (missing kind or components).
 */
export function comboComponents(snapshot: unknown): ComboComponentSnap[] {
  const snap = snapshot as MenuItemSnapshot | null;
  if (!snap || snap.kind !== "combo" || !Array.isArray(snap.components)) return [];
  return snap.components.filter(
    (c): c is ComboComponentSnap => !!c && typeof c.name === "string" && typeof c.qty === "number",
  );
}
