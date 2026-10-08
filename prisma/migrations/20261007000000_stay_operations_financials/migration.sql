CREATE TYPE "StayListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED');
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "ManagerTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

CREATE TABLE "stay_listings" (
  "id" UUID NOT NULL, "propertyId" UUID NOT NULL, "title" VARCHAR(160) NOT NULL,
  "description" TEXT NOT NULL, "hostNote" TEXT NOT NULL, "pricePerNightNgn" INTEGER NOT NULL,
  "cleaningFeeNgn" INTEGER NOT NULL DEFAULT 0, "maxGuests" INTEGER NOT NULL,
  "bedrooms" INTEGER NOT NULL, "bathrooms" INTEGER NOT NULL, "minimumNights" INTEGER NOT NULL DEFAULT 1,
  "amenities" TEXT[] NOT NULL, "houseRules" TEXT[] NOT NULL,
  "status" "StayListingStatus" NOT NULL DEFAULT 'DRAFT', "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "stay_listings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stay_listings_propertyId_key" ON "stay_listings"("propertyId");
CREATE INDEX "stay_listings_status_createdAt_idx" ON "stay_listings"("status", "createdAt");
ALTER TABLE "stay_listings" ADD CONSTRAINT "stay_listings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "stay_blocks" (
  "id" UUID NOT NULL, "listingId" UUID NOT NULL, "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL, "reason" VARCHAR(250) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stay_blocks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stay_blocks_valid_dates" CHECK ("endDate" > "startDate")
);
CREATE INDEX "stay_blocks_listingId_startDate_endDate_idx" ON "stay_blocks"("listingId", "startDate", "endDate");
ALTER TABLE "stay_blocks" ADD CONSTRAINT "stay_blocks_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "stay_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bookings" (
  "id" UUID NOT NULL, "reference" VARCHAR(32) NOT NULL, "listingId" UUID NOT NULL,
  "guestId" UUID NOT NULL, "checkIn" DATE NOT NULL, "checkOut" DATE NOT NULL,
  "guests" INTEGER NOT NULL, "guestName" VARCHAR(160) NOT NULL,
  "guestEmail" VARCHAR(320) NOT NULL, "guestPhone" VARCHAR(30) NOT NULL,
  "nightlyRateNgn" INTEGER NOT NULL, "cleaningFeeNgn" INTEGER NOT NULL,
  "subtotalNgn" INTEGER NOT NULL, "totalNgn" INTEGER NOT NULL,
  "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED', "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bookings_valid_dates" CHECK ("checkOut" > "checkIn")
);
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");
CREATE INDEX "bookings_listingId_status_checkIn_checkOut_idx" ON "bookings"("listingId", "status", "checkIn", "checkOut");
CREATE INDEX "bookings_guestId_createdAt_idx" ON "bookings"("guestId", "createdAt");
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "stay_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "manager_tasks" (
  "id" UUID NOT NULL, "propertyId" UUID NOT NULL, "managerId" UUID NOT NULL,
  "createdById" UUID NOT NULL, "title" VARCHAR(160) NOT NULL, "description" TEXT NOT NULL,
  "status" "ManagerTaskStatus" NOT NULL DEFAULT 'OPEN', "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "manager_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "manager_tasks_managerId_status_dueAt_idx" ON "manager_tasks"("managerId", "status", "dueAt");
CREATE INDEX "manager_tasks_propertyId_createdAt_idx" ON "manager_tasks"("propertyId", "createdAt");
ALTER TABLE "manager_tasks" ADD CONSTRAINT "manager_tasks_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manager_tasks" ADD CONSTRAINT "manager_tasks_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manager_tasks" ADD CONSTRAINT "manager_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "occupancy_events" (
  "id" UUID NOT NULL, "propertyId" UUID NOT NULL, "actorId" UUID NOT NULL,
  "status" "PropertyOccupancy" NOT NULL, "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "occupancy_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "occupancy_events_propertyId_createdAt_idx" ON "occupancy_events"("propertyId", "createdAt");
ALTER TABLE "occupancy_events" ADD CONSTRAINT "occupancy_events_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "occupancy_events" ADD CONSTRAINT "occupancy_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "financial_expenses" (
  "id" UUID NOT NULL, "propertyId" UUID NOT NULL, "createdById" UUID NOT NULL,
  "amountNgn" INTEGER NOT NULL, "category" VARCHAR(60) NOT NULL,
  "description" VARCHAR(500) NOT NULL, "incurredOn" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "financial_expenses_positive_amount" CHECK ("amountNgn" > 0)
);
CREATE INDEX "financial_expenses_propertyId_incurredOn_idx" ON "financial_expenses"("propertyId", "incurredOn");
ALTER TABLE "financial_expenses" ADD CONSTRAINT "financial_expenses_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_expenses" ADD CONSTRAINT "financial_expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
