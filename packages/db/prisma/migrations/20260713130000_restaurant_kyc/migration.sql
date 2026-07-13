-- CreateTable
CREATE TABLE "restaurant_kyc" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerCnic" TEXT NOT NULL,
    "bankAccountName" TEXT,
    "bankIban" TEXT,
    "cnicAssetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ,
    "reviewedByUserId" TEXT,

    CONSTRAINT "restaurant_kyc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_kyc_restaurantId_key" ON "restaurant_kyc"("restaurantId");

-- CreateIndex
CREATE INDEX "restaurant_kyc_status_idx" ON "restaurant_kyc"("status");

-- AddForeignKey
ALTER TABLE "restaurant_kyc" ADD CONSTRAINT "restaurant_kyc_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
