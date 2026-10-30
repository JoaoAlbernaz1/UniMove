ALTER TABLE "users"
  ADD COLUMN "course" TEXT,
  ADD COLUMN "semester" INTEGER,
  ADD COLUMN "bio" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "profile_completed_at" TIMESTAMPTZ(3);
