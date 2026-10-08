ALTER TYPE "UserStatus" ADD VALUE 'INVITED';

ALTER TABLE "users"
  ADD COLUMN "invitationTokenHash" TEXT,
  ADD COLUMN "invitationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "invitedAt" TIMESTAMP(3),
  ADD COLUMN "invitedById" UUID;

CREATE INDEX "users_invitedById_idx" ON "users"("invitedById");

ALTER TABLE "users"
  ADD CONSTRAINT "users_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
