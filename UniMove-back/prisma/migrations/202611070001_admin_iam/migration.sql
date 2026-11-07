
-- CreateEnum
CREATE TYPE "SessionScope" AS ENUM ('APP', 'ADMIN');

-- CreateEnum
CREATE TYPE "AdminPermission" AS ENUM ('MANAGE_ADMINS', 'MANAGE_USERS', 'REVIEW_VERIFICATIONS', 'MODERATE_INCIDENTS', 'VIEW_REPORTS', 'VIEW_AUDIT');

-- CreateEnum
CREATE TYPE "AdminInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AdminRecoveryStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "refresh_sessions" ADD COLUMN     "scope" "SessionScope" NOT NULL DEFAULT 'APP';

-- CreateTable
CREATE TABLE "admin_access" (
    "user_id" UUID NOT NULL,
    "permissions" "AdminPermission"[] DEFAULT ARRAY[]::"AdminPermission"[],
    "granted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_access_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "admin_invites" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "permissions" "AdminPermission"[] DEFAULT ARRAY[]::"AdminPermission"[],
    "status" "AdminInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by_id" UUID NOT NULL,
    "user_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "email_confirmed_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_mfa_recoveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "AdminRecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "token_hash" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_mfa_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_invites_token_hash_key" ON "admin_invites"("token_hash");

-- CreateIndex
CREATE INDEX "admin_invites_email_status_idx" ON "admin_invites"("email", "status");

-- CreateIndex
CREATE INDEX "admin_invites_status_expires_at_idx" ON "admin_invites"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_password_resets_token_hash_key" ON "admin_password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "admin_password_resets_user_id_used_at_idx" ON "admin_password_resets"("user_id", "used_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_mfa_recoveries_token_hash_key" ON "admin_mfa_recoveries"("token_hash");

-- CreateIndex
CREATE INDEX "admin_mfa_recoveries_user_id_status_idx" ON "admin_mfa_recoveries"("user_id", "status");

-- CreateIndex
CREATE INDEX "admin_mfa_recoveries_status_created_at_idx" ON "admin_mfa_recoveries"("status", "created_at");

-- AddForeignKey
ALTER TABLE "admin_access" ADD CONSTRAINT "admin_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_access" ADD CONSTRAINT "admin_access_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_password_resets" ADD CONSTRAINT "admin_password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_mfa_recoveries" ADD CONSTRAINT "admin_mfa_recoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_mfa_recoveries" ADD CONSTRAINT "admin_mfa_recoveries_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Guardas de concorrência que o schema Prisma não expressa.
-- ---------------------------------------------------------------------------

-- Um único convite em aberto por e-mail: dois administradores convidando a mesma
-- pessoa ao mesmo tempo colidem aqui, em vez de gerarem dois tokens válidos.
CREATE UNIQUE INDEX "admin_invites_email_pending_key"
  ON "admin_invites" ("email")
  WHERE "status" = 'PENDING';

-- Uma única recuperação de segundo fator em aberto por conta.
CREATE UNIQUE INDEX "admin_mfa_recoveries_open_key"
  ON "admin_mfa_recoveries" ("user_id")
  WHERE "status" IN ('PENDING', 'APPROVED');

-- ---------------------------------------------------------------------------
-- Segurança do schema public (Supabase Data API): estas tabelas são acessadas
-- exclusivamente pelo backend Prisma, nunca diretamente por anon/authenticated.
-- RLS sem policies bloqueia acesso Data API mesmo onde há grants padrão.
-- Os REVOKEs são condicionais para manter a migração compatível com PostgreSQL
-- de testes que não possui os papéis Supabase.
-- ---------------------------------------------------------------------------
ALTER TABLE "admin_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_password_resets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_mfa_recoveries" ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE
      "admin_access", "admin_invites", "admin_password_resets", "admin_mfa_recoveries"
      FROM "anon";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE
      "admin_access", "admin_invites", "admin_password_resets", "admin_mfa_recoveries"
      FROM "authenticated";
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- Continuidade: quem já é administrador hoje recebe todas as permissões, para
-- que a publicação desta migração não retire nenhum acesso existente. Contas
-- administrativas novas passam a nascer pelo convite, com permissões explícitas.
-- ---------------------------------------------------------------------------
INSERT INTO "admin_access" ("user_id", "permissions", "granted_by_id", "created_at", "updated_at")
SELECT u."id",
       ARRAY['MANAGE_ADMINS', 'MANAGE_USERS', 'REVIEW_VERIFICATIONS',
             'MODERATE_INCIDENTS', 'VIEW_REPORTS', 'VIEW_AUDIT']::"AdminPermission"[],
       NULL,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "users" AS u
JOIN "user_roles" AS ur ON ur."user_id" = u."id"
JOIN "roles" AS r ON r."id" = ur."role_id"
WHERE r."name" = 'ADMIN'
  AND u."deleted_at" IS NULL
ON CONFLICT ("user_id") DO NOTHING;
