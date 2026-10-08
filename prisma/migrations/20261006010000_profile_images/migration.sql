ALTER TABLE "user_profiles" ADD COLUMN "avatarObjectKey" VARCHAR(500);

CREATE TABLE "profile_image_uploads" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "objectKey" VARCHAR(500) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profile_image_uploads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "profile_image_uploads_objectKey_key" ON "profile_image_uploads"("objectKey");
CREATE INDEX "profile_image_uploads_userId_createdAt_idx" ON "profile_image_uploads"("userId", "createdAt");
ALTER TABLE "profile_image_uploads" ADD CONSTRAINT "profile_image_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
