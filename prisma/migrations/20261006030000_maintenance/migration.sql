CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "MaintenanceStatus" AS ENUM ('REPORTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED');
CREATE TYPE "MaintenanceEvidenceType" AS ENUM ('PHOTO', 'DOCUMENT');
CREATE TYPE "MaintenanceEvidenceStatus" AS ENUM ('PENDING', 'READY');
CREATE TYPE "MaintenanceEvidenceKind" AS ENUM ('ISSUE', 'WORK', 'COMPLETION');

CREATE TABLE "maintenance_requests" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "contractorId" UUID,
  "issue" VARCHAR(160) NOT NULL,
  "description" TEXT NOT NULL,
  "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "MaintenanceStatus" NOT NULL DEFAULT 'REPORTED',
  "assignmentNote" TEXT,
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_updates" (
  "id" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "status" "MaintenanceStatus" NOT NULL,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "maintenance_updates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_evidence" (
  "id" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "uploaderId" UUID NOT NULL,
  "status" "MaintenanceEvidenceStatus" NOT NULL DEFAULT 'PENDING',
  "type" "MaintenanceEvidenceType" NOT NULL,
  "kind" "MaintenanceEvidenceKind" NOT NULL,
  "objectKey" VARCHAR(500) NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "caption" VARCHAR(250) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "maintenance_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "maintenance_requests_propertyId_reportedAt_idx" ON "maintenance_requests"("propertyId", "reportedAt");
CREATE INDEX "maintenance_requests_contractorId_status_reportedAt_idx" ON "maintenance_requests"("contractorId", "status", "reportedAt");
CREATE INDEX "maintenance_requests_status_reportedAt_idx" ON "maintenance_requests"("status", "reportedAt");
CREATE INDEX "maintenance_updates_requestId_createdAt_idx" ON "maintenance_updates"("requestId", "createdAt");
CREATE UNIQUE INDEX "maintenance_evidence_objectKey_key" ON "maintenance_evidence"("objectKey");
CREATE INDEX "maintenance_evidence_requestId_status_createdAt_idx" ON "maintenance_evidence"("requestId", "status", "createdAt");

ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_evidence" ADD CONSTRAINT "maintenance_evidence_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_evidence" ADD CONSTRAINT "maintenance_evidence_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
