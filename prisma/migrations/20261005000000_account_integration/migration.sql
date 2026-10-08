CREATE TYPE "AuthChallengePurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_profiles"
  ADD COLUMN "country" VARCHAR(80) NOT NULL DEFAULT 'Nigeria',
  ADD COLUMN "timezone" VARCHAR(80) NOT NULL DEFAULT 'Africa/Lagos';

CREATE TABLE "auth_challenges" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "purpose" "AuthChallengePurpose" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "resendAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "resetTokenHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_challenges_userId_purpose_key" ON "auth_challenges"("userId", "purpose");
CREATE INDEX "auth_challenges_expiresAt_idx" ON "auth_challenges"("expiresAt");
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
