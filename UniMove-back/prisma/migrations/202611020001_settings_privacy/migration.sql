CREATE TYPE "ProfileVisibility" AS ENUM ('UNIVERSITY', 'CONFIRMED');
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" TEXT;

CREATE TABLE "notification_preferences" (
  "user_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "ride_requests" BOOLEAN NOT NULL DEFAULT true,
  "confirmations" BOOLEAN NOT NULL DEFAULT true,
  "reminder_minutes" INTEGER NOT NULL DEFAULT 30,
  "chat_messages" BOOLEAN NOT NULL DEFAULT true,
  "payments" BOOLEAN NOT NULL DEFAULT true,
  "safety" BOOLEAN NOT NULL DEFAULT true,
  "promotions" BOOLEAN NOT NULL DEFAULT false,
  "push" BOOLEAN NOT NULL DEFAULT true,
  "email" BOOLEAN NOT NULL DEFAULT true,
  "sms" BOOLEAN NOT NULL DEFAULT false,
  "do_not_disturb" BOOLEAN NOT NULL DEFAULT true,
  "quiet_start" VARCHAR(5) NOT NULL DEFAULT '22:00',
  "quiet_end" VARCHAR(5) NOT NULL DEFAULT '07:00',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "privacy_preferences" (
  "user_id" UUID NOT NULL,
  "profile_visibility" "ProfileVisibility" NOT NULL DEFAULT 'UNIVERSITY',
  "course_semester" BOOLEAN NOT NULL DEFAULT true,
  "ratings" BOOLEAN NOT NULL DEFAULT true,
  "phone_sharing" BOOLEAN NOT NULL DEFAULT false,
  "real_time_location" BOOLEAN NOT NULL DEFAULT true,
  "frequent_locations" BOOLEAN NOT NULL DEFAULT true,
  "consent_updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "privacy_preferences_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "privacy_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "user_blocks" (
  "blocker_id" UUID NOT NULL,
  "blocked_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id", "blocked_id"),
  CONSTRAINT "user_blocks_blocker_id_fkey"
    FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_blocks_blocked_id_fkey"
    FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks"("blocked_id");

CREATE TABLE "push_devices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "platform" VARCHAR(20) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_devices_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");
CREATE INDEX "push_devices_user_id_active_idx" ON "push_devices"("user_id", "active");

CREATE TABLE "two_factor_auth" (
  "user_id" UUID NOT NULL,
  "secret" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "recovery_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "two_factor_auth_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "two_factor_auth_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "data_export_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "status" "DataExportStatus" NOT NULL DEFAULT 'PENDING',
  "format" VARCHAR(10) NOT NULL DEFAULT 'JSON',
  "error" TEXT,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_export_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "data_export_requests_user_id_requested_at_idx" ON "data_export_requests"("user_id", "requested_at");
