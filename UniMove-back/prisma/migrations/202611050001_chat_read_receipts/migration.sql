ALTER TABLE "chat_messages" ADD COLUMN "read_at" TIMESTAMPTZ(3);
CREATE INDEX "chat_messages_conversation_id_read_at_idx"
ON "chat_messages"("conversation_id", "read_at");
