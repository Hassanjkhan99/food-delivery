-- CreateEnum
CREATE TYPE "RiderDocKind" AS ENUM ('cnic_front', 'cnic_back', 'photo', 'vehicle_registration', 'license');

-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "trustScore" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN     "vehiclePlate" TEXT,
ADD COLUMN     "trainingCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agreementAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sharedModeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verifiedAt" TIMESTAMPTZ,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "boundDeviceId" TEXT;

-- CreateTable
CREATE TABLE "rider_verification_docs" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "kind" "RiderDocKind" NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_verification_docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rider_verification_docs_riderId_idx" ON "rider_verification_docs"("riderId");

-- CreateIndex
CREATE INDEX "riders_verificationStatus_idx" ON "riders"("verificationStatus");

-- AddForeignKey
ALTER TABLE "rider_verification_docs" ADD CONSTRAINT "rider_verification_docs_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_verification_docs" ADD CONSTRAINT "rider_verification_docs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
