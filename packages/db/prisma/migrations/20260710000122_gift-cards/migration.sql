-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('active', 'redeemed', 'void');

-- CreateEnum
CREATE TYPE "WalletTxnKind" AS ENUM ('gift_card_redeem', 'order_debit', 'adjustment');

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "balanceMinor" INTEGER NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'active',
    "purchaserId" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "message" TEXT,
    "providerRef" TEXT,
    "redeemedById" TEXT,
    "redeemedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "kind" "WalletTxnKind" NOT NULL,
    "giftCardId" TEXT,
    "orderId" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_code_key" ON "gift_cards"("code");

-- CreateIndex
CREATE INDEX "gift_cards_purchaserId_idx" ON "gift_cards"("purchaserId");

-- CreateIndex
CREATE INDEX "gift_cards_redeemedById_idx" ON "gift_cards"("redeemedById");

-- CreateIndex
CREATE INDEX "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchaserId_fkey" FOREIGN KEY ("purchaserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
