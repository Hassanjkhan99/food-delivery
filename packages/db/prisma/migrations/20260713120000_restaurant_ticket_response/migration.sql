-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "restaurantRespondedAt" TIMESTAMPTZ,
ADD COLUMN     "restaurantResponse" TEXT;
