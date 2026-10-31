CREATE TYPE "AcademicVerificationStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE "users"
  ADD COLUMN "institutional_email_verified_at" TIMESTAMPTZ(3);

CREATE TABLE "email_verification_challenges" (
  "user_id" UUID NOT NULL,
  "code_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "resend_available_at" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_verification_challenges_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "email_verification_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "academic_verifications" (
  "user_id" UUID NOT NULL,
  "report_guid" VARCHAR(36) NOT NULL,
  "status" "AcademicVerificationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(3),
  "reviewed_by_id" UUID,
  "review_note" VARCHAR(500),
  CONSTRAINT "academic_verifications_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "academic_verifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "academic_verifications_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "academic_verifications_report_guid_key"
  ON "academic_verifications"("report_guid");
CREATE INDEX "academic_verifications_status_submitted_at_idx"
  ON "academic_verifications"("status", "submitted_at");
