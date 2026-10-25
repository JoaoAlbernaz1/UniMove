# UniMove Backend

API REST V1 em NestJS, Prisma 7 e PostgreSQL. Requer Node.js 24 LTS.

## Desenvolvimento

1. Copie `.env.example` para `.env` e substitua os segredos.
2. Instale Docker Desktop (se ainda não existir) e execute `docker compose up -d postgres`.
3. Execute `npm install`, `npm run prisma:generate`, `npm run prisma:migrate` e `npm run prisma:seed`.
4. Inicie com `npm run start:dev`.

Swagger: `http://localhost:3000/docs`. Health: `http://localhost:3000/health`.

O backend usa UTC e as rotas recorrentes registram seu timezone. `.env` nunca deve ser versionado.

## Notificações da V1

As notificações são persistidas exclusivamente no PostgreSQL e consultadas pelo Flutter através da API REST. A V1 não usa SMTP, Firebase, push notifications ou WebSocket. E-mail e push estão planejados para a V2.

As conversas são privadas entre o motorista e cada passageiro com reserva confirmada ou concluída. Mensagens são persistidas no PostgreSQL e consultadas pela API REST autenticada; a notificação interna `MESSAGE_RECEIVED` avisa o outro participante.

Endpoints: `GET /api/v1/messages/conversations`, `GET /api/v1/messages/available-participants`, `POST /api/v1/rides/:rideId/conversations`, `GET /api/v1/messages/conversations/:id/messages` e `POST /api/v1/messages/conversations/:id/messages`. As mensagens aceitam até 2000 caracteres.

Antes de testar, aplique a migration com `npm run prisma:migrate` e use contas reais com uma reserva confirmada ou concluída. Não há usuários de demonstração criados pelo seed.
