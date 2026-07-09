-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "approvedAt" TIMESTAMPTZ,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "lastAccruedAt" TIMESTAMPTZ,
ADD COLUMN     "rejectedReason" TEXT;

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

