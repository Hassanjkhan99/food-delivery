-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "codDisabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trustScore" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "rider_availability" ADD COLUMN     "lastLocationAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pickupPin" TEXT;

-- AlterTable
ALTER TABLE "delivery_tasks" ADD COLUMN     "pickupVerifiedAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "rider_cash_variances" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "expectedMinor" INTEGER NOT NULL,
    "collectedMinor" INTEGER NOT NULL,
    "varianceMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_cash_variances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_anomalies" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "taskId" TEXT,
    "fromLat" DECIMAL(9,6) NOT NULL,
    "fromLng" DECIMAL(9,6) NOT NULL,
    "toLat" DECIMAL(9,6) NOT NULL,
    "toLng" DECIMAL(9,6) NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "elapsedSec" INTEGER NOT NULL,
    "speedKmh" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rider_cash_variances_riderId_createdAt_idx" ON "rider_cash_variances"("riderId", "createdAt");

-- CreateIndex
CREATE INDEX "gps_anomalies_riderId_createdAt_idx" ON "gps_anomalies"("riderId", "createdAt");

-- AddForeignKey
ALTER TABLE "rider_cash_variances" ADD CONSTRAINT "rider_cash_variances_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_anomalies" ADD CONSTRAINT "gps_anomalies_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

