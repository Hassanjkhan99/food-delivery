-- #146 Transparent tax-inclusive pricing.
-- TaxProfile: jurisdiction-specific legal display + responsibility, effective-dated.
ALTER TABLE "tax_profiles"
  ADD COLUMN "label" TEXT NOT NULL DEFAULT 'Sales tax',
  ADD COLUMN "jurisdictionCode" TEXT NOT NULL DEFAULT 'PK',
  ADD COLUMN "responsibility" TEXT NOT NULL DEFAULT 'restaurant',
  ADD COLUMN "registrationStatus" TEXT NOT NULL DEFAULT 'registered',
  ADD COLUMN "registrationNumber" TEXT,
  ADD COLUMN "effectiveFrom" TIMESTAMPTZ NOT NULL DEFAULT now();

-- Order: immutable tax snapshot taken at placement (nullable for legacy rows).
ALTER TABLE "orders"
  ADD COLUMN "taxRateBpsSnapshot" INTEGER,
  ADD COLUMN "taxInclusiveSnapshot" BOOLEAN,
  ADD COLUMN "taxLabelSnapshot" TEXT,
  ADD COLUMN "taxResponsibilitySnapshot" TEXT;

-- OrderItem: immutable per-line tax snapshot (nullable for legacy rows).
ALTER TABLE "order_items"
  ADD COLUMN "taxableMinor" INTEGER,
  ADD COLUMN "taxMinor" INTEGER;
