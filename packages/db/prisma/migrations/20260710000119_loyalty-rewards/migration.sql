-- CreateEnum
CREATE TYPE "LoyaltyReason" AS ENUM ('earn', 'redeem', 'expire', 'adjust');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "loyaltyDiscountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" "LoyaltyReason" NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_userId_key" ON "loyalty_accounts"("userId");

-- CreateIndex
CREATE INDEX "loyalty_ledger_userId_createdAt_idx" ON "loyalty_ledger"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

