-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('percentage', 'fixed', 'free_delivery');

-- CreateEnum
CREATE TYPE "VoucherScope" AS ENUM ('platform', 'restaurant');

-- CreateEnum
CREATE TYPE "VoucherFunder" AS ENUM ('platform', 'restaurant', 'split');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voucherId" TEXT;

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "VoucherType" NOT NULL,
    "scope" "VoucherScope" NOT NULL DEFAULT 'platform',
    "funder" "VoucherFunder" NOT NULL DEFAULT 'platform',
    "valueBps" INTEGER NOT NULL DEFAULT 0,
    "valueMinor" INTEGER NOT NULL DEFAULT 0,
    "maxDiscountMinor" INTEGER,
    "minOrderMinor" INTEGER NOT NULL DEFAULT 0,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "perUserLimit" INTEGER DEFAULT 1,
    "totalBudgetMinor" INTEGER,
    "usedBudgetMinor" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "restaurantId" TEXT,
    "startsAt" TIMESTAMPTZ,
    "endsAt" TIMESTAMPTZ,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_redemptions" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reversedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_code_key" ON "vouchers"("code");

-- CreateIndex
CREATE INDEX "vouchers_code_idx" ON "vouchers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_redemptions_orderId_key" ON "voucher_redemptions"("orderId");

-- CreateIndex
CREATE INDEX "voucher_redemptions_voucherId_userId_idx" ON "voucher_redemptions"("voucherId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_redemptions_voucherId_orderId_key" ON "voucher_redemptions"("voucherId", "orderId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

