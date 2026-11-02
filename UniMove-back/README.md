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
com offset ou `Z`), `timezone` (IANA), `availableSeats` (1–6),
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

## Conquistas

`GET /api/v1/users/me/achievements` retorna as oito conquistas do usuário
autenticado, com `items`, `total` e `unlockedCount`. Cada item tem título,
descrição, ícone, `unlocked` e progresso calculado no servidor. O endpoint é
somente leitura e usa uma consulta agregada consistente, sem alterar o histórico
nem exigir nova migração. Critérios completos: `docs/sugestoes-conquistas.md`.
Conta apenas viagens concluídas compartilhadas, exclui reservas canceladas e
ausências, deduplica viagens e participantes e verifica origem das avaliações.

## Perfil obrigatório

Antes das demais funcionalidades, a conta precisa concluir o perfil em
`PATCH /api/v1/users/me/profile`, com `course`, `semester` (inteiro), `bio` e
`tags` (de 3 a 10 textos distintos, sem diferenciar maiúsculas/minúsculas).
O campo `fullName` é opcional nessa atualização. A rota recebe o conjunto completo
dos dados, inclusive na edição, impedindo remover os obrigatórios depois.
`GET /api/v1/users/me/profile-policy` fornece limites e orientações ao formulário.
`GET /api/v1/users/me` retorna os dados reais e `profileCompletedAt`.

`DELETE /api/v1/users/me` exige a senha atual e apaga a conta de forma
irreversível. A operação é recusada enquanto houver carona futura como motorista,
solicitação pendente ou reserva confirmada. Após a confirmação, identificadores
diretos e documentos pessoais são removidos, sessões são invalidadas e o perfil
é desidentificado. Registros operacionais mínimos permanecem sem nome, CPF,
e-mail, matrícula, comentários ou mensagens associados; o UUID técnico do
registro pode permanecer para preservar relações históricas, portanto isso é
pseudonimização, não promessa de anonimização irreversível. Contas desativadas
não podem continuar usando tokens de acesso existentes.

A migração `202610290003_required_profile` adiciona os campos sem preencher dados
fictícios em contas antigas. Enquanto `profileCompletedAt` for nulo, o guard da
API responde 403 com código `PROFILE_INCOMPLETE` nas demais funcionalidades.
Autenticação e gestão da própria conta permanecem acessíveis. Após concluir,
o mesmo token já pode acessar as funcionalidades; não é necessário novo login.

## Validação cadastral por comprovante acadêmico

`POST /api/v1/users/me/verification/academic-document` recebe
`multipart/form-data` com o campo `document`. Aceita PDF digital de até 5 MB
e cinco páginas, extrai texto localmente e compara nome, matrícula, curso,
modelo da declaração e código GUID do relatório com o perfil. PDFs escaneados
sem texto extraível não são aceitos. O arquivo não é persistido.

Uma correspondência de texto não comprova autenticidade. A solicitação permanece
`PENDING_REVIEW` até que um administrador do UniMove confira o GUID no validador
público TOTVS indicado no comprovante e aprove ou rejeite a solicitação. A fila
está em `GET /api/v1/admin/academic-verifications`; a revisão usa
`PATCH /api/v1/admin/academic-verifications/:userId` com `status` igual a
`APPROVED` ou `REJECTED` e, para rejeição, `reviewNote`. Essas rotas exigem a
role `ADMIN`. A tela de revisão aparece em Configurações para contas com essa
role. Essa é uma permissão do próprio UniMove, sem dependência de acesso
administrativo ao portal UCB/TOTVS. Para concedê-la a uma conta existente, um
operador autorizado configura `SEED_ADMIN_EMAIL` com o e-mail dessa conta e
executa `npm run prisma:seed` uma vez em ambiente seguro conectado ao banco; a
role é adicionada sem trocar a senha da conta. Remova a variável após a operação.
Alterar nome, matrícula ou curso invalida uma validação anterior.

A migração `202610300001_identity_verification` cria os dados da validação
acadêmica. A migração `202611010001_remove_email_code_verification` remove a
estrutura que havia sido criada para confirmação por código de e-mail.

A validação acadêmica aprovada é obrigatória para usuários buscarem ou
oferecerem caronas, solicitarem vagas e confirmarem solicitações. A exigência é
aplicada pela API; usuários sem comprovante, pendentes ou rejeitados recebem
bloqueio, e caronas de motoristas sem aprovação não aparecem nas buscas. Contas
com role `ADMIN` são isentas dessa exigência e continuam podendo revisar os
documentos. As demais exigências de motorista, como role `DRIVER` e CNH,
continuam valendo.
Contas com role `ADMIN` também não precisam enviar comprovante; elas continuam
com acesso à tela administrativa para aprovar ou rejeitar as solicitações.

O PDF é recebido em memória pelo backend, analisado e descartado ao final da
requisição (os buffers usados pela aplicação são zerados). Nenhum arquivo é
gravado no banco ou apresentado na fila administrativa. Documentos ilegíveis,
fora do modelo ou com dados divergentes são recusados automaticamente e não
entram na fila. Para os PDFs aceitos, a tela **Configurações > Administração >
Revisões cadastrais** mostra os dados do usuário e o GUID; o administrador
consulta o GUID no portal oficial e aprova ou rejeita o resultado. O banco
persiste status, GUID, decisão, responsável, horário e motivo da rejeição, não
o conteúdo do PDF.

## Cadastro de veículos e habilitação de motorista

`POST /api/v1/vehicles` recebe `multipart/form-data`, com o campo `data` contendo
JSON de `brand`, `model`, `color`, `plate`, `year` e `passengerCapacity`, e o arquivo
`driverLicense` (foto da CNH). A conta autenticada recebe o veículo e o papel `DRIVER`
na mesma transação, mantendo o papel `PASSENGER`. Não há criação de outra conta.
O cliente deve renovar o token em `POST /api/v1/auth/refresh` após o cadastro
para atualizar as permissões de publicação.

`GET /api/v1/vehicles/registration-policy` fornece os limites para o formulário:
de 1 a 6 vagas para passageiros e ano do modelo de 1990 até o ano atual mais um.
O ano atual é calculado no fuso `America/Sao_Paulo` a cada validação e consulta,
sem depender de reinício do servidor. A placa aceita formato antigo ou Mercosul
e é normalizada em maiúsculas, sem espaços/hífen; placas duplicadas retornam 409.
Rotas, publicações e solicitações também têm limite de seis passageiros.
A migração `202610290002_driver_license_upload` cria `driver_licenses` com RLS
sem políticas públicas. A imagem é reencodificada em JPEG, limitada a 2000 pixels
no maior lado e armazenada como bytes no PostgreSQL privado, sem diretório ou URL
pública. O upload aceita JPEG/PNG/WebP de até 5 MB e remove metadados. Não há
OCR, checagem documental, validade ou aprovação manual; imagem enviada libera
a publicação imediatamente quando os demais dados são válidos.

`PATCH /api/v1/vehicles/:id` usa o mesmo multipart e permite editar os dados do veículo pertencente
à conta autenticada, com as mesmas regras do cadastro. Marca e modelo rejeitam
emojis; cor permite letras Unicode, espaços e hífen. A política do formulário
também retorna `fieldMaxLengths`. Não é permitido reduzir a capacidade abaixo
das vagas oferecidas em caronas ou rotas ainda ativas.

CNH é vinculada à conta: se já existe foto, não é preciso reenviá-la. Um novo
arquivo substitui o anterior na mesma transação de gravação. A rota autenticada
`GET /api/v1/vehicles/driver-license` retorna apenas presença/data de envio do
próprio usuário, sem bytes da imagem. Fotos não aparecem nas consultas de caronas.
Contas antigas precisam anexar CNH em **Editar carro** para publicar novas ofertas.
As regras de publicação avulsa, criação de rotas e matching recorrente exigem a foto.
Armazenar imagens no PostgreSQL atende o protótipo sem outro serviço; em escala,
o conteúdo deve ser movido para object storage privado. A proposta de análise
futura está em `docs/proposta-verificacao-cnh.md` na raiz do repositório.

## Mensagens

As conversas usam as tabelas `message_conversations` e `chat_messages` já existentes. Uma
conversa é vinculada a uma carona e a um passageiro com reserva confirmada; o motorista e
esse passageiro podem consultar o histórico. Reservas concluídas mantêm o histórico acessível,
mas somente reservas confirmadas aceitam novas mensagens. A API REST autenticada oferece:

- `GET /api/v1/messages/conversations` — conversas do usuário.
- `GET /api/v1/messages/available-participants` — participantes elegíveis das caronas.
- `POST /api/v1/rides/:rideId/conversations` — inicia ou recupera conversa; motorista informa `{ "passengerId": "..." }`.
- `GET /api/v1/messages/conversations/:id/messages` — até as 100 mensagens mais recentes.

O envio e a entrega em tempo real usam **Socket.IO exclusivamente para conversas**, no
namespace `/chat`, com transporte WebSocket. A conexão envia o JWT de acesso em
`handshake.auth.token`. Cada cliente deve entrar na conversa antes de enviar mensagens:

- `conversation:join` com `{ "conversationId": "..." }`; confirmação `{ "ok": true }`.
- `conversation:send` com `{ "conversationId": "...", "content": "..." }`; conteúdo de até
  2.000 caracteres. O servidor persiste a mensagem antes de confirmar e transmiti-la.
- `conversation:message` entrega a mensagem salva a todos os participantes conectados na sala.

Confirmações de evento retornam `{ "ok": true, "data": ... }` ou
`{ "ok": false, "error": "..." }`. A autorização de entrada e envio verifica a participação
na conversa e a reserva no backend. O cliente reconecta automaticamente e usa o histórico
REST com cursor `after` para recuperar mensagens perdidas durante uma desconexão. Cada
mensagem continua persistida no PostgreSQL e também gera uma notificação `MESSAGE_RECEIVED`.
O gateway limita cada usuário a 100 eventos de conversa por minuto.

O token WebSocket expira junto com o JWT de acesso; na reconexão, o app renova a sessão antes
de autenticar novamente. A entrega em tempo real funciona com uma instância do backend; para
executar várias instâncias, é necessário configurar um adapter Socket.IO compartilhado para
propagar os eventos entre elas. Não há servidor ou serviço externo de mensageria configurado.
Consulte [a documentação detalhada do módulo](../docs/chat-conversas-tempo-real.md) para o
fluxo completo, eventos, autorização, reconexão e limitações.

O backend usa UTC e as rotas recorrentes registram seu timezone. `.env` nunca deve ser versionado.

## Notificações da V1

As notificações são persistidas exclusivamente no PostgreSQL e consultadas pelo app através da API REST. O WebSocket é reservado à entrega das mensagens de conversa; notificações gerais não usam push ou WebSocket. E-mail e push estão planejados para a V2.

As mensagens usam Socket.IO para entrega em tempo real; notificações gerais permanecem na API REST.
