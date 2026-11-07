# Gestão de identidade administrativa do UniMove

Entrega de 07/11/2026. Branch `feat/admin-iam`, baseada em `main` (`d1cafbf`).
**Nenhuma alteração foi feita em produção**: a migração não foi aplicada no
Supabase, o deploy não foi disparado e nenhuma variável de ambiente foi mexida.

O objetivo é tirar o provisionamento de administrador do terminal: criar conta
administrativa passa a ser um convite autorizado, com confirmação de endereço,
senha, segundo fator obrigatório e permissões explícitas. Recuperação de senha e
do autenticador deixam de depender do operador no caso comum.

## Onde cada coisa mora

| Peça | Origem real | Revisão |
|---|---|---|
| API em `unimove-api-jn5z.onrender.com` | `JoaoAlbernaz1/UniMove`, `main`, via `render.yaml` | `d1cafbf` |
| Painel em `unimove-delta.vercel.app` | `JoaoAlbernaz1/UniCarona-Admin-MVP`, `feat/unicarona-admin-mvp` | `3b9ac65` |
| Este trabalho de backend | `UniMove`, `feat/admin-iam` | — |
| Contratos do frontend | `UniCarona-Admin-MVP`, `feat/admin-iam-contracts` | — |

**Duplicação a resolver depois:** o repositório do painel carrega uma cópia de
`UniMove-back`, que agora está defasada. Só a do `UniMove` vai para produção.
Enquanto as duas existirem, qualquer mudança de backend precisa ser feita aqui e
a cópia do outro repositório tratada como morta — ou, melhor, o painel passa a
morar neste monorepo e a cópia é removida. A decisão é do João.

## O que já existia e foi reaproveitado

Nada de framework novo de autenticação. O que foi reusado, sem alteração de
comportamento:

- `AuthAttemptLimiter` — contador de falhas e consumo de TOTP compartilhado no
  PostgreSQL, com HMAC e advisory lock. Serve a várias instâncias, que é o que o
  Render exige. Usado em todas as rotas novas.
- `two-factor-crypto` — AES-256-GCM com `TWO_FACTOR_ENCRYPTION_KEY`. **A chave de
  produção não foi tocada.**
- `admin-session.ts` — cookies de primeira parte, CSRF por double submit e
  verificação de origem. As rotas públicas novas também conferem a origem.
- `AdminRoute()` e `RolesGuard` — papel ADMIN atual lido do banco e segundo fator
  confirmado. Continua valendo para tudo.
- `admin-invariants.ts` — invariante do último administrador, com lock comum.
- Argon2id para senha, `AuditLog` para auditoria.

Duas duplicações foram eliminadas no caminho:

- A validação de CPF saiu de dentro de `AuthService` para
  `common/validators/cpf.ts`. O cadastro de estudante e a ativação de
  administrador aplicam agora literalmente a mesma regra.
- A geração de segredo, QR e códigos de recuperação saiu de
  `AdminEnrollmentService` para `admin-two-factor.ts`. Convite, recuperação e a
  CLI de operador usam o mesmo código; o comportamento da CLI não mudou e seu
  teste continua passando.

## Módulos novos

```
UniMove-back/src/modules/mail/
  mail.service.ts            Envio transacional. smtp | log | none.
  admin-mail.templates.ts    Seis modelos em pt-BR, HTML e texto.
  mail.module.ts

UniMove-back/src/modules/admin/
  admin-permissions.ts       Catálogo e normalização das permissões.
  admin-permission.guard.ts  @AdminPermissionRoute(...) e a guarda.
  admin-reauth.service.ts    Step-up: senha + TOTP no próprio pedido.
  admin-two-factor.ts        Segredo, URI, QR e códigos de recuperação.
  admin-tokens.ts            Token de 256 bits e hash SHA-256.
  admin-invites.service.ts   Ciclo do convite, do convite ao acesso.
  admin-accounts.service.ts  Lista, permissões e revogação de acesso.
  admin-recovery.service.ts  Senha e segundo fator.
  admin-sessions.service.ts  Sessões do painel.
  admin-accounts.controller.ts   Rotas com sessão.
  admin-onboarding.controller.ts Rotas públicas do aceite e da recuperação.
  admin-recovery.cli.ts      Procedimento emergencial do operador.
```

`MailService` é separado de `NotificationService` de propósito: aquele serve o
aplicativo, respeita preferência e horário de silêncio do usuário; este não pode
ser silenciado por preferência alguma e precisa alcançar quem ainda não tem
conta. O corpo das mensagens carrega token de uso único, então só o destinatário
mascarado e o assunto chegam ao log.

## Permissões

Enum `AdminPermission`: `MANAGE_ADMINS`, `MANAGE_USERS`,
`REVIEW_VERIFICATIONS`, `MODERATE_INCIDENTS`, `VIEW_REPORTS`, `VIEW_AUDIT`.
A tabela `admin_access` guarda uma linha por conta administrativa.

**Ausência de linha equivale a nenhuma permissão.** Não há herança implícita: um
ADMIN sem linha não gerencia acessos. Para que a publicação não retire nada de
quem já trabalha hoje, a migração **insere uma linha com todas as permissões para
cada conta ADMIN existente**. Contas novas nascem pelo convite, com permissões
explícitas.

`GET /admin/permissions` devolve o catálogo com rótulo, descrição e a marca
`sensitive` (só `MANAGE_ADMINS`), para a interface não repetir texto.

**Decisão deliberada:** as rotas administrativas que já existiam
(`/admin/users`, `/admin/rides`, `/admin/incidents`, relatórios, auditoria)
**não** passaram a exigir permissão. Elas seguem abertas a qualquer ADMIN com
segundo fator, exatamente como hoje. Exigir permissão nelas é uma linha por rota
(`@AdminPermissionRoute(AdminPermission.MANAGE_USERS)` em vez de `@AdminRoute()`)
e deve ser uma rodada própria, depois de confirmar em produção que o backfill
funcionou — se algo falhar ali, o painel inteiro fecha para quem está de plantão.
As permissões novas são validadas no backend em todas as rotas de gestão de
acesso, que é onde o risco está.

## Endpoints

### Com sessão do painel (cookie + CSRF + origem)

| Método e rota | Permissão | O que faz |
|---|---|---|
| `GET /admin/permissions` | qualquer ADMIN | Catálogo de permissões |
| `GET /admin/sessions` | qualquer ADMIN | Sessões do painel da própria conta |
| `DELETE /admin/sessions/:id` | qualquer ADMIN | Encerra uma sessão própria |
| `POST /admin/sessions/revoke-others` | qualquer ADMIN | Encerra as outras sessões próprias |
| `GET /admin/admins` | `MANAGE_ADMINS` | Lista de administradores |
| `PATCH /admin/admins/:id/permissions` | `MANAGE_ADMINS` + reauth | Altera permissões |
| `POST /admin/admins/:id/revoke` | `MANAGE_ADMINS` + reauth | Encerra o acesso administrativo |
| `GET /admin/admins/:id/sessions` | `MANAGE_ADMINS` | Sessões de outro administrador |
| `POST /admin/admins/:id/sessions/revoke` | `MANAGE_ADMINS` + reauth | Derruba as sessões dele |
| `GET /admin/invites` | `MANAGE_ADMINS` | Histórico de convites |
| `POST /admin/invites` | `MANAGE_ADMINS` | Emite convite |
| `POST /admin/invites/:id/revoke` | `MANAGE_ADMINS` | Revoga convite pendente |
| `GET /admin/mfa-recoveries` | `MANAGE_ADMINS` | Fila de recuperação de fator |
| `POST /admin/mfa-recoveries/:id/review` | `MANAGE_ADMINS` + reauth | Aprova ou recusa |

Listas seguem a convenção que já existia: array no corpo, total em
`X-Total-Count`. `GET /admin/admins` acrescenta `X-Pending-Invites`.

### Públicas (sem sessão, com origem conferida e limite por IP e por token)

| Método e rota | O que faz |
|---|---|
| `POST /admin/auth/invites/confirm-email` | Valida o convite e carimba a confirmação do endereço |
| `POST /admin/auth/invites/password` | Cria a conta (ou confirma a existente) e provisiona o autenticador |
| `POST /admin/auth/invites/two-factor` | Confirma o código, concede o acesso e entrega os códigos de recuperação |
| `POST /admin/auth/password-reset` | Pede redefinição. Resposta neutra |
| `POST /admin/auth/password-reset/confirm` | Troca a senha |
| `POST /admin/auth/mfa-recovery` | Pede recuperação do fator. Exige a senha |
| `POST /admin/auth/mfa-recovery/start` | Invalida o fator atual e provisiona o novo. Exige a senha |
| `POST /admin/auth/mfa-recovery/confirm` | Confirma o novo fator e entrega códigos novos |

`GET /admin/auth/session` passou a devolver também `permissions`.

### Reautenticação

Toda operação que muda quem tem acesso pede `password` e `twoFactorCode` no
próprio corpo. O código é consumido por `claimCode`, então não serve duas vezes.

Consequência de interface que precisa estar na tela: o autenticador mostra o
mesmo número por 30 segundos, e quem acabou de entrar com aquele número recebe
`401 ADMIN_REAUTH_CODE_ALREADY_USED` — "este código já foi usado, aguarde o
próximo", nunca "código inválido", que mandaria a pessoa conferir a senha à toa.

## Ciclo do convite

1. Gestor com `MANAGE_ADMINS` emite o convite para um e-mail de domínio
   institucional autorizado, com as permissões já escolhidas.
2. Token de 32 bytes aleatórios; o banco guarda só o SHA-256. O token em claro
   existe apenas no e-mail e nunca entra em log ou auditoria.
3. O e-mail leva o link, o prazo e as permissões.
4. Abrir o link confirma o endereço (`emailConfirmedAt`).
5. Conta nova informa CPF e senha; conta de estudante existente confirma a senha
   atual — **o convite nunca troca a senha de uma conta que já existe**.
6. O autenticador é provisionado desabilitado (QR, segredo e `otpauth://`).
7. O código confirmado ativa o fator, concede o papel ADMIN e grava as
   permissões, tudo na mesma transação.
8. Oito códigos de recuperação são exibidos uma única vez; o banco guarda só
   hashes argon2id.
9. O convite vira `ACCEPTED`. Uso único.
10. O acesso vale no login seguinte, com senha e segundo fator.

Até o passo 7 a conta não tem papel ADMIN nem permissão alguma: convite
abandonado no meio não deixa acesso aberto. Prazo padrão de 72 horas.

## Recuperação

**Senha.** Pedido responde sempre a mesma coisa, com o mesmo custo de hash,
exista a conta ou não. Token de uso único, 30 minutos, guardado como hash; um
pedido novo invalida o anterior. Confirmar troca a senha, **derruba todas as
sessões** (painel e aplicativo, porque a credencial é a mesma), audita e avisa
por e-mail. O segundo fator não é tocado: continua obrigatório.

**Segundo fator.** O pedido exige e-mail **e senha** — só o acesso à caixa de
entrada nunca desativa o fator. Os administradores com `MANAGE_ADMINS` são
avisados; o próprio solicitante não pode aprovar. A aprovação exige
reautenticação do revisor e só então nasce o token de uso único, enviado a quem
pediu. O passo seguinte pede a senha outra vez, apaga o fator antigo e seus
códigos, derruba as sessões e provisiona o novo autenticador. Confirmado o
código, saem códigos de recuperação novos. Um pedido em aberto por conta,
garantido por índice parcial.

**Último administrador.** Quando não há outro gestor para aprovar, resta o
procedimento de operador: `npm run admin:recover-mfa -- email@ucb.edu.br`. Exige
terminal privado interativo, confirmação digitada, `TWO_FACTOR_ENCRYPTION_KEY` e
acesso ao banco. Apaga o fator e provisiona o novo no mesmo ato, auditando
`ADMIN_2FA_RESET_BY_OPERATOR`. **Não existe rota HTTP equivalente.**

## Sessões

`refresh_sessions` ganhou a coluna `scope` (`APP` por padrão, `ADMIN` para a
sessão do painel). O painel lista e revoga apenas o escopo `ADMIN`: a sessão do
aplicativo não é dele gerenciar. A detecção de reuso de refresh token, a
expiração e a renovação continuam como estavam.

Sessão aberta antes da migração está marcada como `APP` e por isso não aparece
na lista; volta a aparecer no login seguinte. É cosmético e se resolve sozinho.

## Auditoria

Eventos padronizados, sem token, código, código de recuperação ou segredo:

`ADMIN_INVITE_CREATED`, `ADMIN_INVITE_EMAIL_FAILED`,
`ADMIN_INVITE_EMAIL_CONFIRMED`, `ADMIN_INVITE_PASSWORD_SET`,
`ADMIN_INVITE_ACCEPTED`, `ADMIN_INVITE_REVOKED`, `ADMIN_PERMISSIONS_CHANGED`
(com o antes e o depois), `ADMIN_ACCESS_REVOKED`,
`ADMIN_PASSWORD_RESET_REQUESTED`, `ADMIN_PASSWORD_RESET_COMPLETED`,
`ADMIN_MFA_RECOVERY_REQUESTED`, `ADMIN_MFA_RECOVERY_APPROVED`,
`ADMIN_MFA_RECOVERY_REJECTED`, `ADMIN_MFA_RECOVERY_STARTED`,
`ADMIN_MFA_RECOVERY_COMPLETED`, `ADMIN_SESSION_REVOKED`,
`ADMIN_SESSIONS_REVOKED_OTHERS`, `ADMIN_SESSIONS_REVOKED_BY_MANAGER`,
`ADMIN_REAUTH_FAILED`, `ADMIN_2FA_RESET_BY_OPERATOR`.

Os que já existiam (`ADMIN_LOGIN`, `ADMIN_LOGIN_FAILED`, `ADMIN_2FA_FAILED`,
`ADMIN_ACCESS_DENIED`, `ADMIN_SESSION_REUSE_DETECTED`, `ADMIN_LOGOUT`,
`ADMIN_2FA_ENROLLED`) continuam iguais. Um teste de integração afirma que
nenhum token do e-mail, nenhum número de seis dígitos e nenhum segredo gravado
aparece no `audit_logs`.

## Banco e migração

`prisma/migrations/202611070001_admin_iam/migration.sql`. Nada destrutivo:
quatro tabelas novas, quatro enums novos, uma coluna com valor padrão.

| Objeto | Para que |
|---|---|
| enum `SessionScope` | Separa sessão do painel da do aplicativo |
| enum `AdminPermission` | Permissões administrativas |
| enum `AdminInviteStatus` | `PENDING`, `ACCEPTED`, `REVOKED` |
| enum `AdminRecoveryStatus` | `PENDING`, `APPROVED`, `COMPLETED`, `REJECTED` |
| `refresh_sessions.scope` | `NOT NULL DEFAULT 'APP'` |
| `admin_access` | Permissões por conta |
| `admin_invites` | Convites, com hash do token |
| `admin_password_resets` | Redefinições, com hash do token |
| `admin_mfa_recoveries` | Recuperações supervisionadas |

Dois índices parciais fazem o banco rejeitar a corrida, em vez de depender da
aplicação acertar o momento:

```sql
CREATE UNIQUE INDEX admin_invites_email_pending_key
  ON admin_invites (email) WHERE status = 'PENDING';
CREATE UNIQUE INDEX admin_mfa_recoveries_open_key
  ON admin_mfa_recoveries (user_id) WHERE status IN ('PENDING','APPROVED');
```

E o backfill de continuidade, idempotente:

```sql
INSERT INTO admin_access (user_id, permissions, ...)
SELECT u.id, ARRAY[... todas as permissões ...], ...
FROM users u JOIN user_roles ur ... JOIN roles r ...
WHERE r.name = 'ADMIN' AND u.deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;
```

Toda operação crítica roda em transação, com `FOR UPDATE` na linha do convite ou
do pedido e com o advisory lock de `admin-invariants.ts` quando o número de
administradores pode cair. Mudanças de estado usam `updateMany` condicionado ao
estado anterior: quem marcar primeiro leva.

## Variáveis de ambiente

Todas opcionais. **A API sobe sem nenhuma delas** e apenas as rotas que enviam
link recusam, com `ADMIN_PANEL_URL_MISSING` — publicar o backend antes de
configurar o e-mail é seguro.

| Variável | Padrão | Para que |
|---|---|---|
| `ADMIN_PANEL_URL` | — | Base dos links do e-mail. HTTPS em produção |
| `ADMIN_INVITE_TTL_HOURS` | 72 | Validade do convite (1 a 720) |
| `ADMIN_PASSWORD_RESET_TTL_MINUTES` | 30 | Validade do link de senha (5 a 1440) |
| `ADMIN_MFA_RECOVERY_TTL_HOURS` | 24 | Validade do pedido e do link (1 a 168) |
| `ADMIN_INVITE_EMAIL_DOMAINS` | — | Vazio usa `ALLOWED_INSTITUTIONAL_EMAIL_DOMAINS` |
| `MAIL_PROVIDER` | `smtp` se houver SMTP, senão `log` | `smtp`, `log` ou `none` |
| `MAIL_FROM` | `SMTP_FROM` ou `SMTP_USER` | Remetente |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` | — | Provedor transacional |

Nenhuma credencial foi inventada ou escrita no repositório. Sem SMTP, o convite é
criado e a resposta traz `delivery: "NOT_CONFIGURED"` — a tela precisa dizer que
o convite existe mas o link não foi enviado.

## Testes executados

Tudo nesta máquina, em 07/11/2026, contra um PostgreSQL local descartável
(`127.0.0.1:5433/unimove_test`). **Nenhum teste tocou produção.**

| Verificação | Resultado |
|---|---|
| `npm run lint` | Sem erros ou avisos |
| `npm run typecheck` | Sem erros |
| `npm test` | **419 testes em 42 suítes**, todos passando (eram 320 em 34) |
| `npm run build` | Concluído |
| `npm run test:iam-integration` | **30 de 30**, duas execuções consecutivas |
| `npm run test:admin-integration` | **59 de 59** — suíte anterior, sem regressão |
| `npm run test:security-integration` | Passou (exige `DATABASE_URL` exportado) |
| `npm run test:booking` | Passou — fluxo de reserva do aplicativo |
| `npm run test:integration` | Passou — busca de caronas do aplicativo |
| `npm run test:search-regression` | 10 de 10 |

As 99 verificações novas cobrem: autorização por permissão; convite, expiração,
reuso de token, convites simultâneos e ativação; MFA válido, inválido e
reutilizado; códigos de recuperação como hash; recuperação de senha e do
autenticador; permissões; revogação de sessões; falha de e-mail; limite de
tentativas; auditoria; escalonamento de privilégio; e a compatibilidade do login
que já existia.

O que só o banco real prova, e por isso está na suíte de integração: dois
convites simultâneos para o mesmo e-mail (um vence, um recebe 409), duas
ativações simultâneas do mesmo convite (uma só concede acesso), dois gestores
revogando um ao outro ao mesmo tempo (sobra pelo menos um), e dois pedidos
simultâneos de recuperação (um só é aberto).

`test:iam-integration` leva alguns minutos de propósito: um TOTP só vale uma vez,
então o teste espera a virada da janela de 30 segundos quando precisa de um
código novo. Esperar é o comportamento correto, e preferível a um teste que
aceita código repetido.

## Riscos e pendências

1. **Nada foi publicado.** Migração, deploy e variáveis de ambiente continuam
   pendentes. A lista está no fim deste documento.
2. **Sem SMTP configurado, convite e recuperação não chegam ao destinatário.**
   O backend avisa pela resposta e pela auditoria, mas é preciso escolher um
   provedor transacional antes de usar o fluxo de verdade.
3. **Rotação coordenada da credencial do PostgreSQL.** Uma credencial do banco
   foi compartilhada em conversa anteriormente. Ela precisa ser rotacionada no
   Supabase, com atualização simultânea no Render — **não foi rotacionada aqui**,
   porque derrubaria a API em produção sem aviso. Depende de aprovação e de
   combinar a janela. O banco está na conta de outro integrante do grupo.
4. **Permissões nas rotas antigas.** Deliberadamente fora desta entrega, pelo
   motivo explicado acima. Deve ser uma rodada própria.
5. **A cópia de `UniMove-back` no repositório do painel ficou defasada.**
6. **Teste com o backend real ainda não feito** para os fluxos novos: só o
   PostgreSQL local foi exercitado.
7. **Não testado:** leitor de tela, iOS real, auditoria automática de WCAG.
   Nenhuma tela foi criada nesta etapa, então isso vale para a próxima.

## Lista de publicação

### Render (backend)

1. Fazer merge de `feat/admin-iam` na `main` do `JoaoAlbernaz1/UniMove`.
2. Conferir que o `startCommand` do `render.yaml` continua rodando
   `prisma migrate deploy` — é ele que aplica `202611070001_admin_iam`.
3. **Antes do deploy**, decidir com o dono do banco a janela da migração. Ela é
   aditiva e rápida, mas insere uma linha por administrador existente.
4. Configurar, no painel do Render: `ADMIN_PANEL_URL=https://unimove-delta.vercel.app`
   e, quando houver provedor, `MAIL_PROVIDER=smtp` com `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM`.
5. Não alterar `TWO_FACTOR_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`,
   `JWT_REFRESH_SECRET` nem `ADMIN_PANEL_ORIGINS`.
6. Depois do deploy, conferir no banco que `admin_access` tem uma linha por
   conta ADMIN e que o administrador atual continua entrando no painel.
7. Conferir que `GET /api/v1/admin/auth/session` passou a devolver `permissions`.

### Vercel (painel)

8. O frontend desta etapa só acrescentou tipos, cliente de API e o auxiliar de
   permissão. Nenhuma tela mudou, então o deploy é seguro e opcional.
9. A CSP do `vercel.json` não precisa de mudança: as rotas novas usam a mesma
   origem, pelo rewrite que já existe.
10. Quando as telas do Figma entrarem, revisar a CSP se elas carregarem o QR de
    outro lugar — hoje o QR vem como `data:` URI, já permitido por `img-src`.

### Verificação depois de publicar

11. Emitir um convite de teste para um endereço institucional controlado pela
    equipe e percorrer os quatro passos até o login.
12. Conferir que o convite aceito aparece em `GET /admin/invites` como `ACCEPTED`
    e que `admin_access` tem exatamente as permissões escolhidas.
13. Pedir uma redefinição de senha de teste e confirmar que o segundo fator
    continua sendo exigido no login seguinte.
