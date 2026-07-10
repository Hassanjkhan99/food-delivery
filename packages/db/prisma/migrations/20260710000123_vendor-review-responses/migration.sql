-- CreateTable
CREATE TABLE "rating_responses" (
    "id" TEXT NOT NULL,
    "ratingId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rating_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rating_responses_ratingId_key" ON "rating_responses"("ratingId");

-- CreateIndex
CREATE INDEX "rating_responses_restaurantId_idx" ON "rating_responses"("restaurantId");

-- AddForeignKey
ALTER TABLE "rating_responses" ADD CONSTRAINT "rating_responses_ratingId_fkey" FOREIGN KEY ("ratingId") REFERENCES "ratings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

