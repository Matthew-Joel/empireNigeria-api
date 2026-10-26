CREATE TYPE "InspectionConsent" AS ENUM ('NOT_RECORDED', 'GRANTED', 'DISCUSSION_REQUESTED');

ALTER TABLE "properties"
    ADD COLUMN "inspectionConsent" "InspectionConsent" NOT NULL DEFAULT 'NOT_RECORDED',
    ADD COLUMN "inspectionConsentAt" TIMESTAMP(3),
    ADD COLUMN "inspectionConsentById" UUID,
    ADD COLUMN "inspectionConsentNote" TEXT,
    ADD COLUMN "inspectionConsentRequestedAt" TIMESTAMP(3),
    ADD COLUMN "inspectionReadyAt" TIMESTAMP(3);

ALTER TABLE "properties"
    ADD CONSTRAINT "properties_inspectionConsentById_fkey" FOREIGN KEY ("inspectionConsentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inspections"
    ADD COLUMN "accessConfirmedAt" TIMESTAMP(3),
    ADD COLUMN "accessConfirmedById" UUID,
    ADD COLUMN "accessContact" VARCHAR(160),
    ADD COLUMN "occupantAuthorised" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "accessNote" TEXT;

ALTER TABLE "inspections"
    ADD CONSTRAINT "inspections_accessConfirmedById_fkey" FOREIGN KEY ("accessConfirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "manager_tasks" ADD COLUMN "kind" VARCHAR(40);

-- Properties already waiting for inspection start their coordination clock now.
-- Consent is deliberately not backfilled: staff record it with a note.
UPDATE "properties" SET "inspectionReadyAt" = "updatedAt" WHERE "status" = 'INSPECTION_PENDING';

-- Visits already booked before access confirmation existed must not be blocked.
UPDATE "inspections"
SET "accessConfirmedAt" = "createdAt",
    "accessNote" = 'Arranged before access confirmation was introduced'
WHERE "status" IN ('SCHEDULED', 'IN_PROGRESS');
