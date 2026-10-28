ALTER TABLE "users"
  ADD COLUMN "terms_accepted_at" TIMESTAMPTZ(3),
  ADD COLUMN "terms_version" TEXT,
  ADD COLUMN "privacy_policy_version" TEXT;
