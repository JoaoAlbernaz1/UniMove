# UniMove Backend

API REST V1 em NestJS, Prisma 7 e PostgreSQL. Requer Node.js 24 LTS.

## Desenvolvimento

1. Copie `.env.example` para `.env` e substitua os segredos.
2. Instale Docker Desktop (se ainda não existir) e execute `docker compose up -d postgres`.
3. Execute `npm install`, `npm run prisma:generate`, `npm run prisma:migrate` e `npm run prisma:seed`.
4. Inicie com `npm run start:dev`.

Swagger: `http://localhost:3000/docs`. Health: `http://localhost:3000/health`.

## Mensagens

As conversas usam as tabelas `message_conversations` e `chat_messages` já existentes. Uma
conversa é vinculada a uma carona e a um passageiro com reserva confirmada; o motorista e
esse passageiro podem consultar o histórico. Reservas concluídas mantêm o histórico acessível,
mas somente reservas confirmadas aceitam novas mensagens. A API autenticada oferece:

- `GET /api/v1/messages/conversations` — conversas do usuário.
- `GET /api/v1/messages/available-participants` — participantes elegíveis das caronas.
- `POST /api/v1/rides/:rideId/conversations` — inicia ou recupera conversa; motorista informa `{ "passengerId": "..." }`.
- `GET /api/v1/messages/conversations/:id/messages` — até as 100 mensagens mais recentes.
- `POST /api/v1/messages/conversations/:id/messages` — envia `{ "content": "..." }` (até 2.000 caracteres).

O envio também cria uma notificação `MESSAGE_RECEIVED` para o outro participante. O app
atualiza a conversa por polling REST a cada quatro segundos.

O backend usa UTC e as rotas recorrentes registram seu timezone. `.env` nunca deve ser versionado.

## Notificações da V1

As notificações são persistidas exclusivamente no PostgreSQL e consultadas pelo Flutter através da API REST. A V1 não usa SMTP, Firebase, push notifications ou WebSocket. E-mail e push estão planejados para a V2.

O app consulta a API REST para atualizar as mensagens; notificações push e WebSocket não fazem parte da V1.
