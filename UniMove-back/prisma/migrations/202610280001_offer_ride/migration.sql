ALTER TABLE "rides"
  ADD COLUMN "price_per_person_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "additional_info" VARCHAR(1000),
  ADD COLUMN "accepts_luggage" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allows_music" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "accepts_pets" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "rides" ADD CONSTRAINT "rides_price_per_person_cents_check"
  CHECK ("price_per_person_cents" >= 0 AND "price_per_person_cents" <= 1000000);
