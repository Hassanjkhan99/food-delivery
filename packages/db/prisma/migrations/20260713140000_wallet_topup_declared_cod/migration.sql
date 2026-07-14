-- Codex #116: idempotent wallet top-ups + Codex #113: declared COD collected.
-- Both additive (nullable column + new table), safe to apply online.

-- AlterTable
ALTER TABLE "delivery_tasks" ADD COLUMN     "codCollectedMinor" INTEGER;

-- CreateTable
CREATE TABLE "wallet_topups" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerRef" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_topups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_topups_idempotencyKey_key" ON "wallet_topups"("idempotencyKey");

-- CreateIndex
CREATE INDEX "wallet_topups_userId_createdAt_idx" ON "wallet_topups"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
