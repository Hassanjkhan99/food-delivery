-- #54 Fulfillment modes: pickup + scheduled orders.
-- Additive migration authored by hand (no live DB / shadow DB available at build time).
-- Apply with a live DB via `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "FulfillmentMode" AS ENUM ('delivery', 'pickup');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "fulfillmentMode" "FulfillmentMode" NOT NULL DEFAULT 'delivery',
ADD COLUMN     "scheduledFor" TIMESTAMPTZ,
ADD COLUMN     "pickupCode" TEXT;
