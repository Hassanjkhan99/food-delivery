// Customer price-display preference (#146). Switches whether prices are shown tax-INCLUSIVE
// ("Including tax", the default) or tax-EXCLUSIVE ("Before tax"). This is presentation only —
// it never changes the payable total, which is always server-computed. Persisted across
// sessions/surfaces via localStorage, mirroring the cart stores.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PriceDisplayMode } from "@fd/shared";

type PriceDisplayState = {
  mode: PriceDisplayMode;
  setMode: (mode: PriceDisplayMode) => void;
  toggle: () => void;
};

export const usePriceDisplay = create<PriceDisplayState>()(
  persist(
    (set, get) => ({
      // Tax-inclusive by default so customers compare the actual payable food price.
      mode: "inclusive",
      setMode: (mode) => set({ mode }),
      toggle: () => set({ mode: get().mode === "inclusive" ? "exclusive" : "inclusive" }),
    }),
    { name: "fd-price-display" },
  ),
);
