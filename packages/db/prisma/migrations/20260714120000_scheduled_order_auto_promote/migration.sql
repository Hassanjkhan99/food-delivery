-- #199: auto-promote scheduled ("pre-order") orders into the kitchen's New lane at
-- scheduledFor - leadTime. Additive nullable column + supporting index, safe to apply online.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "scheduledPromotedAt" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "orders_status_scheduledFor_idx" ON "orders"("status", "scheduledFor");
