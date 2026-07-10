-- CreateEnum
CREATE TYPE "DeliveryOfferStatus" AS ENUM ('pending', 'accepted', 'declined', 'expired', 'withdrawn');

-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "sharedOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trustScore" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "shared_rider_policies" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sharingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vetoActive" BOOLEAN NOT NULL DEFAULT false,
    "maxActiveJobs" INTEGER NOT NULL DEFAULT 1,
    "maxPickupMeters" INTEGER NOT NULL DEFAULT 1500,
    "maxIncrementalDelaySec" INTEGER NOT NULL DEFAULT 300,
    "codTrustThreshold" INTEGER NOT NULL DEFAULT 70,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shared_rider_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_offers" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" "DeliveryOfferStatus" NOT NULL DEFAULT 'pending',
    "matchedScore" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "pickupMeters" INTEGER,
    "incrementalDelaySec" INTEGER,
    "isSharedRider" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "offeredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ,
    "declineReason" TEXT,

    CONSTRAINT "delivery_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_rider_policies_restaurantId_key" ON "shared_rider_policies"("restaurantId");

-- CreateIndex
CREATE INDEX "delivery_offers_taskId_status_idx" ON "delivery_offers"("taskId", "status");

-- CreateIndex
CREATE INDEX "delivery_offers_riderId_status_idx" ON "delivery_offers"("riderId", "status");

-- AddForeignKey
ALTER TABLE "shared_rider_policies" ADD CONSTRAINT "shared_rider_policies_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "delivery_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

