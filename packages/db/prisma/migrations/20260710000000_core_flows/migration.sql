-- AlterEnum
ALTER TYPE "DeliveryTaskStatus" ADD VALUE 'offered';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliveryEventType" ADD VALUE 'offered';
ALTER TYPE "DeliveryEventType" ADD VALUE 'accepted';
ALTER TYPE "DeliveryEventType" ADD VALUE 'declined';

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cutleryRequested" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tipAmount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "delivery_tasks" ADD COLUMN     "acceptedAt" TIMESTAMPTZ,
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "offeredAt" TIMESTAMPTZ,
ADD COLUMN     "podMediaId" TEXT;

-- CreateTable
CREATE TABLE "branch_hours" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openMinute" INTEGER NOT NULL,
    "closeMinute" INTEGER NOT NULL,

    CONSTRAINT "branch_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "areaLabel" TEXT,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_hours_branchId_idx" ON "branch_hours"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");

-- AddForeignKey
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_podMediaId_fkey" FOREIGN KEY ("podMediaId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

