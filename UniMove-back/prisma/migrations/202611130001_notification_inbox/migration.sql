-- Central de notificações: novos tipos de atividade e índices da caixa de entrada.
-- Somente acrescenta valores ao enum e índices; nenhum dado existente é alterado.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RIDE_REQUEST_SENT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RIDE_PUBLISHED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROMOTION';

-- Listagem paginada da caixa de entrada (mais recentes primeiro).
CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx"
  ON "notifications"("user_id", "created_at" DESC);

-- Agrupamento de mensagens não lidas da mesma conversa e leitura por recurso.
CREATE INDEX IF NOT EXISTS "notifications_user_id_type_resource_id_read_at_idx"
  ON "notifications"("user_id", "type", "resource_id", "read_at");
