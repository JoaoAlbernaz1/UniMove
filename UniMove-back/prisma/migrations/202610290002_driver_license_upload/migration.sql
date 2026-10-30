CREATE TABLE "driver_licenses" (
  "user_id" UUID NOT NULL,
  "image" BYTEA NOT NULL,
  "mime_type" TEXT NOT NULL DEFAULT 'image/jpeg',
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "driver_licenses_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "driver_licenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "driver_licenses_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880)
);

-- Sem políticas públicas: clientes do Supabase não podem consultar os documentos.
-- O acesso é feito exclusivamente pelo backend com a conexão PostgreSQL privada.
ALTER TABLE "driver_licenses" ENABLE ROW LEVEL SECURITY;
