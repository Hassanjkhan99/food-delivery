-- Support ticket queue (issue #14): agent ownership + SLA tracking columns.
-- Additive only. Hand-written because migrate diff needs a shadow DB (offline);
-- verify against the schema and re-generate with a live DB before applying.

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "assignedToName" TEXT,
ADD COLUMN     "firstRespondedAt" TIMESTAMPTZ,
ADD COLUMN     "resolvedAt" TIMESTAMPTZ,
ADD COLUMN     "resolutionNote" TEXT;

-- CreateIndex
CREATE INDEX "support_tickets_status_createdAt_idx" ON "support_tickets"("status", "createdAt");
