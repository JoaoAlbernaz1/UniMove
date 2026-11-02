DROP TABLE IF EXISTS "email_verification_challenges";

ALTER TABLE "users"
  DROP COLUMN IF EXISTS "institutional_email_verified_at";
