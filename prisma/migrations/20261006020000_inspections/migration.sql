CREATE TYPE "InspectionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'REPORT_READY', 'CANCELLED');
CREATE TYPE "InspectionFindingSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "InspectionEvidenceType" AS ENUM ('PHOTO', 'DOCUMENT');
CREATE TYPE "InspectionEvidenceStatus" AS ENUM ('PENDING', 'READY');

CREATE TABLE "inspections" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "inspectorId" UUID NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "purpose" VARCHAR(160) NOT NULL,
    "summary" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_reports" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "overview" TEXT NOT NULL,
    "recommendations" TEXT[] NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inspection_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_findings" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "area" VARCHAR(100) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "severity" "InspectionFindingSeverity" NOT NULL,
    "detail" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "inspection_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_evidence" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "uploaderId" UUID NOT NULL,
    "status" "InspectionEvidenceStatus" NOT NULL DEFAULT 'PENDING',
    "type" "InspectionEvidenceType" NOT NULL,
    "objectKey" VARCHAR(500) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "caption" VARCHAR(250) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "inspection_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inspections_propertyId_scheduledAt_idx" ON "inspections"("propertyId", "scheduledAt");
CREATE INDEX "inspections_inspectorId_status_scheduledAt_idx" ON "inspections"("inspectorId", "status", "scheduledAt");
CREATE INDEX "inspections_status_scheduledAt_idx" ON "inspections"("status", "scheduledAt");
CREATE UNIQUE INDEX "inspections_one_open_per_property_idx" ON "inspections"("propertyId") WHERE "status" IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');
CREATE UNIQUE INDEX "inspection_reports_inspectionId_key" ON "inspection_reports"("inspectionId");
CREATE INDEX "inspection_findings_reportId_position_idx" ON "inspection_findings"("reportId", "position");
CREATE UNIQUE INDEX "inspection_evidence_objectKey_key" ON "inspection_evidence"("objectKey");
CREATE INDEX "inspection_evidence_inspectionId_status_createdAt_idx" ON "inspection_evidence"("inspectionId", "status", "createdAt");

ALTER TABLE "inspections" ADD CONSTRAINT "inspections_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "inspection_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspection_evidence" ADD CONSTRAINT "inspection_evidence_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspection_evidence" ADD CONSTRAINT "inspection_evidence_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
