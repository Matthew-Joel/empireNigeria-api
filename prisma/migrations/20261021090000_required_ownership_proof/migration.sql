-- Existing properties retain their review status and are not retrospectively
-- classified as verified ownership evidence. New API-created properties opt in
-- to the proof requirement and start in DRAFT.
ALTER TYPE "PropertyStatus" ADD VALUE 'DRAFT' BEFORE 'SUBMITTED';
ALTER TYPE "PropertyFileStatus" ADD VALUE 'DELETING';

CREATE TYPE "OwnershipDocumentType" AS ENUM (
    'CERTIFICATE_OF_OCCUPANCY',
    'DEED_OF_ASSIGNMENT',
    'DEED_OF_CONVEYANCE',
    'REGISTERED_SURVEY_PLAN',
    'GRANT_OF_PROBATE',
    'LETTER_OF_ADMINISTRATION'
);

ALTER TABLE "properties"
    ADD COLUMN "ownershipProofRequired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "property_files"
    ADD COLUMN "ownershipDocumentType" "OwnershipDocumentType";

ALTER TABLE "property_files"
    ADD CONSTRAINT "property_files_ownership_document_type_check"
    CHECK ("ownershipDocumentType" IS NULL OR "purpose" = 'DOCUMENT');
