# UniMove Backend

API REST V1 em NestJS, Prisma 7 e PostgreSQL. Requer Node.js 24 LTS.

## Desenvolvimento

1. Copie `.env.example` para `.env` e substitua os segredos.
2. Instale Docker Desktop (se ainda não existir) e execute `docker compose up -d postgres`.
3. Execute `npm install`, `npm run prisma:generate`, `npm run prisma:migrate` e `npm run prisma:seed`.
4. Inicie com `npm run start:dev`.

Swagger: `http://localhost:3000/docs`. Health: `http://localhost:3000/health`.

## Consultas e regras no servidor

- `GET /api/v1/rides` aceita `origin`, `destination`, `date` (`dd/mm/aaaa`), `time`
  (`HH:mm` exato), `timezone` (IANA, padrão `America/Sao_Paulo`), `page` e `limit`
  (1–100). Retorna `{ items, total, page, limit }`. Os filtros, ordenação e
  paginação são executados no PostgreSQL; nome de local ignora acentos e caixa.
  A data e a hora são interpretadas no timezone enviado pelo dispositivo.
- Cada motorista na busca contém `ratingAverage` e `ratingCount`, agregados no
  servidor. Sem avaliações, a média é `null` e a quantidade é zero.
- `GET /api/v1/rides/upcoming` seleciona até três caronas futuras do usuário,
  ordenadas pela saída: como motorista ou passageiro com reserva confirmada.
  Retorna também `participationRole` e `reservedSeats` para apresentação na Home.
- `GET /api/v1/auth/registration-policy` é público e fornece requisitos de senha,
  domínios institucionais e textos/versionamento de termos e privacidade.
- O cadastro exige `passwordConfirmation`, `acceptedTerms: true`, `termsVersion`
  e `privacyPolicyVersion`, além dos campos existentes. A API normaliza o nome
  antes de validar, verifica a força da senha e registra o aceite com horário do
  servidor. A troca de senha aplica a mesma política. Mudanças nos documentos
  exigem atualizar suas versões em `registration-policy.ts`.
- A migração `202610280002_registration_consent` adiciona os campos de aceite.
  Contas antigas mantêm esses campos vazios; não há aceite retroativo automático.

`npm run test:integration` compila e valida consultas/cadastro no PostgreSQL do
`.env` com dados isolados, revertendo todos os cadastros de teste na transação.

## Publicar carona avulsa

`POST /api/v1/rides` exige autenticação e perfil `DRIVER`. O corpo contém
`vehicleId`, `originLocationId`, `destinationLocationId`, `departureAt` (ISO 8601
com offset ou `Z`), `timezone` (IANA), `availableSeats` (1–4),
`pricePerPersonCents` (inteiro de 0 a 1.000.000), `acceptsLuggage`, `allowsMusic`,
`acceptsPets` e, opcionalmente, `additionalInfo` (até 1.000 caracteres).

A API exige partida futura, locais ativos e diferentes, veículo ativo do próprio
motorista e vagas dentro da capacidade. A criação da rota de suporte e da carona
ocorre na mesma transação. A rota de suporte fica inativa e sem dias recorrentes:
a publicação cria somente a viagem da data escolhida.

A migração `202610280001_offer_ride` adiciona preço, observações e preferências
à tabela `rides`, com valores padrão para os registros existentes. Para outros
ambientes, execute `npm run prisma:deploy` e `npm run prisma:generate` antes de
iniciar a versão atualizada. Os testes da publicação rodam com `npm test`.

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
