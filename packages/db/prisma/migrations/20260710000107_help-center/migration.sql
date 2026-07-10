-- Help center (#45): customer-visible resolution + structured intake on support
-- tickets, plus an optional link from a ticket to the refund it opened.
-- Additive only. Hand-written because the workspace has no live/shadow DB;
-- regenerate with `prisma migrate diff` against a live DB before applying if desired.

-- AlterTable
ALTER TABLE "support_tickets"
    ADD COLUMN "resolutionNote" TEXT,
    ADD COLUMN "contextJson" JSONB,
    ADD COLUMN "refundId" TEXT;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
