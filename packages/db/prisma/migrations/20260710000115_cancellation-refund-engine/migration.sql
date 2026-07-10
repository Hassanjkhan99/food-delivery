-- AlterTable
ALTER TABLE "cancellations" ADD COLUMN     "faultParty" TEXT,
ADD COLUMN     "policyNote" TEXT,
ADD COLUMN     "policyOutcome" TEXT,
ADD COLUMN     "refundMinor" INTEGER;

-- CreateTable
CREATE TABLE "branch_cancellation_stats" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "penaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "rejectCount" INTEGER NOT NULL DEFAULT 0,
    "expiredCount" INTEGER NOT NULL DEFAULT 0,
    "faultCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_cancellation_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_cancellation_stats_branchId_key" ON "branch_cancellation_stats"("branchId");

-- AddForeignKey
ALTER TABLE "branch_cancellation_stats" ADD CONSTRAINT "branch_cancellation_stats_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

