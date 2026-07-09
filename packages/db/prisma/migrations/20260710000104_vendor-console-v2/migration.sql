-- Vendor console v2 (#46) — additive only, safe to apply online.

-- Busy mode: extra prep minutes added to every ETA instead of pausing the branch.
-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "prepBufferMinutes" INTEGER NOT NULL DEFAULT 0;

-- Timed 86: when an item marked unavailable from the board should return (informational).
-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "unavailableUntil" TIMESTAMPTZ;
