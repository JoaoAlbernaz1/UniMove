ALTER TABLE "users"
  ADD COLUMN "student_number" VARCHAR(10);

CREATE UNIQUE INDEX "users_student_number_key" ON "users"("student_number");

CREATE TABLE "profile_photos" (
  "user_id" UUID NOT NULL,
  "image" BYTEA NOT NULL,
  "mime_type" TEXT NOT NULL DEFAULT 'image/jpeg',
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "profile_photos_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "profile_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profile_photos_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880)
);

ALTER TABLE "profile_photos" ENABLE ROW LEVEL SECURITY;
