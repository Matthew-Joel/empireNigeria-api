CREATE TYPE "PropertyStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'INSPECTION_PENDING', 'APPROVED', 'CHANGES_REQUESTED');
CREATE TYPE "PropertyOccupancy" AS ENUM ('OCCUPIED', 'VACANT', 'UNDER_MAINTENANCE', 'AVAILABLE_FOR_SHORT_LET', 'TEMPORARILY_UNAVAILABLE');
CREATE TYPE "PropertyFilePurpose" AS ENUM ('PHOTO', 'DOCUMENT');
CREATE TYPE "PropertyFileStatus" AS ENUM ('PENDING', 'READY');

CREATE TABLE "properties" (
  "id" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "managerId" UUID,
  "name" VARCHAR(160) NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "description" TEXT NOT NULL,
  "address" VARCHAR(250) NOT NULL,
  "city" VARCHAR(100) NOT NULL,
  "state" VARCHAR(100) NOT NULL,
  "country" VARCHAR(100) NOT NULL DEFAULT 'Nigeria',
  "occupancyStatus" "PropertyOccupancy" NOT NULL DEFAULT 'VACANT',
  "tenantName" VARCHAR(160),
  "tenantPhone" VARCHAR(30),
  "tenancyStart" DATE,
  "status" "PropertyStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "properties_ownerId_createdAt_idx" ON "properties"("ownerId", "createdAt");
CREATE INDEX "properties_managerId_status_idx" ON "properties"("managerId", "status");
CREATE INDEX "properties_status_createdAt_idx" ON "properties"("status", "createdAt");
ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "properties" ADD CONSTRAINT "properties_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "property_files" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "uploaderId" UUID NOT NULL,
  "purpose" "PropertyFilePurpose" NOT NULL,
  "status" "PropertyFileStatus" NOT NULL DEFAULT 'PENDING',
  "objectKey" VARCHAR(500) NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "isCover" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "property_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "property_files_objectKey_key" ON "property_files"("objectKey");
CREATE INDEX "property_files_propertyId_status_purpose_idx" ON "property_files"("propertyId", "status", "purpose");
ALTER TABLE "property_files" ADD CONSTRAINT "property_files_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "property_files" ADD CONSTRAINT "property_files_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
