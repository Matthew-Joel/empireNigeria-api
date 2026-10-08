ALTER TYPE "MaintenanceStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'APPROVED';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'QUOTE_REJECTED';

CREATE TYPE "MaintenanceQuoteStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE "maintenance_quotes" (
  "id" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "contractorId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "MaintenanceQuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
  "amountNgn" INTEGER NOT NULL,
  "scope" TEXT NOT NULL,
  "expectedDurationDays" INTEGER NOT NULL,
  "notes" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  CONSTRAINT "maintenance_quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL,
  "actorId" UUID,
  "actorRole" "UserRole" NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "entityType" VARCHAR(40) NOT NULL,
  "entityId" UUID NOT NULL,
  "summary" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "maintenance_quotes_requestId_revision_key" ON "maintenance_quotes"("requestId", "revision");
CREATE INDEX "maintenance_quotes_requestId_submittedAt_idx" ON "maintenance_quotes"("requestId", "submittedAt");
CREATE INDEX "audit_events_createdAt_id_idx" ON "audit_events"("createdAt", "id");
CREATE INDEX "audit_events_entityType_entityId_createdAt_idx" ON "audit_events"("entityType", "entityId", "createdAt");
CREATE INDEX "audit_events_actorId_createdAt_idx" ON "audit_events"("actorId", "createdAt");

ALTER TABLE "maintenance_quotes" ADD CONSTRAINT "maintenance_quotes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
