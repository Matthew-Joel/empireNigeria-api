CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserRole" AS ENUM (
  'ADMIN',
  'OWNER',
  'GUEST',
  'PROPERTY_MANAGER',
  'INSPECTOR',
  'CONTRACTOR'
);

CREATE TYPE "UserStatus" AS ENUM (
  'PENDING',
  'ACTIVE',
  'SUSPENDED'
);

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(320) NOT NULL,
  "phone" VARCHAR(30),
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
  "emailVerifiedAt" TIMESTAMP(3),
  "verificationCodeHash" TEXT,
  "verificationExpiresAt" TIMESTAMP(3),
  "refreshTokenHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "firstName" VARCHAR(80) NOT NULL,
  "lastName" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
