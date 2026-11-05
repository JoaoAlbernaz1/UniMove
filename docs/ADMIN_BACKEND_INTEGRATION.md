# Integração real do UniCarona Admin

Preparação de 05/11/2026 para a entrega de 06/11/2026. Este documento é um
procedimento de publicação: nenhum passo de produção foi executado nesta entrega.

## Repositório e comparação

| Referência | Revisão | Resultado |
|---|---|---|
| Render informado pelo responsável | `JoaoAlbernaz1/UniMove`, `main`, `fb25c8b` | API anterior, sem sessão do painel |
| `main` original conferida no início | `e07cfeb` | Correção posterior no histórico do app, preservada |
| Backend administrativo de origem | `JoaoAlbernaz1/UniCarona-Admin-MVP`, `feat/unicarona-admin-mvp`, `25f07f3` | 45 arquivos de backend/configuração comparados |
| Branch desta integração | `feat/admin-backend-integration`, no **UniMove original** | Baseada em `e07cfeb`, sem merge em `main` |
| Transplante inicial | `744dc61` | Patch de três vias do backend, sem copiar frontend ou trocar o esquema |

O ancestral comum é `fb25c8b`. Entre ele e `e07cfeb` não havia alterações em
`UniMove-back` ou `render.yaml`. A alteração posterior do app, portanto, não foi
sobrescrita. A branch de melhorias visuais `feat/admin-interface-usability` e seu
PR #1 pertencem ao outro repositório e não publicam a API.

As mudanças trazidas abrangem: módulo administrativo; autenticação por cookies;
guards de papel/MFA; usuários e consequências operacionais; revisão acadêmica;
consulta de caronas; denúncias; indicadores, CSV e auditoria; configuração e testes.
Os arquivos `prisma/schema.prisma` e `prisma/migrations/` continuam idênticos à main
original. Não é necessário criar banco ou tabela para esta integração.

## Segurança aplicada

| Problema anterior | Comportamento preparado |
|---|---|
| Senha de ADMIN permitia cadastrar o autenticador por HTTP | Login sem fator ativo retorna `403 ADMIN_ENROLLMENT_REQUIRED`, sem QR, segredo, challenge de cadastro ou tokens |
| Settings do app também permitia iniciar/trocar o fator administrativo | Setup, enable e disable de ADMIN exigem o procedimento de operador; papel atual é consultado no banco |
| Bearer do app acessava todas as ferramentas administrativas | Só os métodos acadêmicos explicitamente marcados aceitam Bearer, com ADMIN atual e MFA; demais ferramentas exigem sessão por cookie |
| Refresh legado podia renovar acesso administrativo sem MFA | ADMIN exige fator atual ativo e refresh com MFA; a família recusada é revogada |
| Expiração persistida podia ser contornada pelo refresh | A sessão administrativa também verifica a validade registrada no banco |
| Tentativas e replay de TOTP existiam só em memória | Estado compartilhado no PostgreSQL, com HMAC e advisory locks; oito falhas bloqueiam por 15 minutos, replay por 120 segundos |
| Senha podia ser testada no app ignorando a trava do painel | Os dois logins compartilham a mesma chave de proteção por conta |
| Exclusão mantinha telefone, fator e dispositivos push | Remoção atômica dessas informações, com rollback em falha |
| Exclusão concorrente com suspensão podia perder o último admin | Lock comum, bloqueio dos candidatos e isolamento serializável; conflito conhecido retorna `409 ACCOUNT_CONCURRENT_UPDATE` |
| Valores inválidos de origem, TTL ou proxy eram aceitos | Origens explícitas, HTTPS em produção, duração limitada e confiança em no máximo um proxy |

Os eventos administrativos sobre terceiros e seus revisores permanecem ligados à
conta anonimizada. IP pessoal do autor é removido. Checkpoints internos mutáveis
de autenticação ficam fora do endpoint de auditoria do painel.

O fator administrativo é provisionado por um operador em terminal privado; não
existe endpoint HTTP para isso. A CLI não substitui fator ativo. O QR fica apenas
em memória, em uma URL aleatória de loopback, até a confirmação. Códigos de
recuperação são exibidos uma vez e armazenados com hash.

## Configuração sem exposição de valores

| Variável | Preparação necessária |
|---|---|
| `ADMIN_PANEL_ORIGINS` | Lista de origens completas e estáveis do painel, separadas por vírgula. Em produção, somente HTTPS, sem wildcard, caminho, query ou fragmento. Vazia, o login do painel é recusado. |
| `TWO_FACTOR_ENCRYPTION_KEY` | Segredo aleatório de pelo menos 32 caracteres. Se já existir, **preservar exatamente**. Se ausente, criar somente após autorização e guardar no cofre do responsável. A produção não inicia sem chave válida. |
| `TRUST_PROXY_HOPS` | `1` no serviço Render existente; `0` para conexão direta local. Outros valores são recusados. Não usar confiança irrestrita nos cabeçalhos. |
| `ADMIN_SESSION_MAX_HOURS` | Opcional, inteiro de 1 a 24; padrão 12. A renovação não prolonga o prazo máximo. |
| `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Manter os valores atuais. Não recriar, rotacionar, copiar para o repositório ou exibir no chat. |

O `render.yaml` contém apenas nomes e mecanismos de configuração. `sync: false`
não adiciona variáveis novas durante o sync de um serviço existente; elas devem
ser configuradas manualmente. **Save only** salva variáveis sem implantar; os
novos valores só entram em uso no próximo deploy autorizado.

Referências: [variáveis no Render](https://render.com/docs/configure-environment-variables),
[limites de sync:false](https://render.com/docs/blueprint-spec#prompting-for-secret-values).

## Compatibilidade com o aplicativo

- Cadastro, login, refresh, perfil, veículos, CNH, publicação, busca, reservas e
  conquistas mantêm as rotas e os formatos esperados pelos estudantes.
- A busca continua exigindo vínculo acadêmico aprovado. A fixture foi corrigida;
  a regra real não foi relaxada. Alterar curso invalida o vínculo anterior.
- Papéis atuais vêm do banco: cadastrar um veículo pode habilitar a oferta com o
  mesmo token, sem depender de uma role antiga assinada no JWT.
- O app mantém o fluxo de segundo fator dos estudantes. Para ADMIN, o primeiro
  provisionamento passa a ser operacional, seguido do login normal com MFA.
- Verificações do app administrativo continuam em array. Ações adicionais do
  painel não são disponibilizadas pelo Bearer do app.
- Não há mudanças de interface, dependências ou arquivos do frontend nesta branch.

## Validação reproduzível local e no CI

Resultados locais desta entrega, com PostgreSQL 17 descartável:

| Verificação | Resultado |
|---|---|
| Backend, testes unitários | 284 passaram em 31 suítes |
| Integração HTTP administrativa | 59 passaram |
| Exclusão, rollback e concorrência do último admin | 4 passaram no PostgreSQL real |
| Limitador persistente | Duas instâncias, recriação de cliente, oito falhas concorrentes, um vencedor entre 12 claims TOTP e expiração conferidos |
| Fluxos HTTP dos estudantes | Cadastro, perfil, veículo/CNH, promoção, refresh, publicação, busca, reservas e conquistas passaram; rollback confirmado |
| Frontend dos estudantes | 5 testes, typecheck e lint passaram; nenhum arquivo alterado |
| Backend, lint/typecheck/build | Sem erros |
| `npm audit --omit=dev` | Zero alertas de produção |
| YAML do Render | Válido contra o schema oficial localmente; nenhum sync/deploy executado |

O teste de rollback injeta uma falha de auditoria e verifica que a transação foi
desfeita; a linha de erro esperada nesse caso não representa falha da suíte. O
teste estudantil em transação única emite um aviso de depreciação do adaptador `pg`
por consultas concorrentes nesse cliente de teste; as asserções e o rollback passam.

Use Node 24 e PostgreSQL 17. Configure exclusivamente um banco descartável local
com nome terminado em `_test`. Nunca aponte os testes para produção.

```text
cd UniMove-back
npm ci --include=dev
npm run prisma:generate
npm run prisma:deploy
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:security-integration
npm run test:admin-integration
npm run build

cd ../UniMove-front
npm ci
npm test
npm run typecheck
npm run lint
```

`prisma:deploy` acima é **somente no banco local de testes**. A suíte administrativa
recusa hosts não locais, produção ou nomes sem `_test`, e faz TRUNCATE nesse banco.
A reprodução focada do último admin deve iniciar sem outros admins de fixtures;
os testes focados removem somente seus próprios registros. A suíte compartilhada
também limpa seu banco ao terminar. Execute as suítes sequencialmente, não em paralelo.

O workflow executável fica em `.github/workflows/backend-admin.yml`, na raiz do
monorepo. Ele cria apenas o PostgreSQL descartável do runner GitHub Actions. O
workflow antigo dentro de `UniMove-back/.github` não é carregado pelo GitHub como
workflow do monorepo.

## Publicação exata — somente após autorização

### 1. Travar a publicação automática antes de integrar

No serviço **existente** `unimove-api`, confirmar repositório
`JoaoAlbernaz1/UniMove`, branch `main`, Root Directory `UniMove-back`, e host
`https://unimove-api-jn5z.onrender.com`. Não usar New Blueprint, New Web Service
ou New Database.

Após autorização para alterar a configuração, desativar Auto-Deploy **antes** de
fazer merge. Alterar o YAML na branch não muda, por si só, a configuração do
serviço já existente. Conferir também automações ligadas ao merge no projeto dos
estudantes. [Comportamento do auto-deploy](https://render.com/docs/deploys#automatic-deploys).

### 2. Preparar as variáveis preservando as credenciais

No Environment do mesmo serviço, verificar apenas a presença dos nomes. Adicionar
as variáveis administrativas ausentes conforme a tabela, preservando as demais.
Não mostrar ou registrar seus valores. Selecionar **Save only**, não Save and deploy.
Não sincronizar um novo Blueprint para tentar obter esses segredos.

### 3. Conferir o esquema sem migrar

Um operador autorizado, usando a conexão existente em ambiente privado, executa
`npm run prisma:generate` e `npm exec -- prisma migrate status`. Este último é uma
conferência de estado. Se houver migração pendente, divergência ou falha, interromper:
esta branch não inclui migração nova, e qualquer migração de produção exige
autorização separada. Não usar `migrate dev`, `db push`, reset ou seed em produção.

### 4. Integrar o PR e preparar os comandos do serviço

Somente após autorização de merge, integrar o PR na `main` original e registrar o
SHA resultante. Auto-Deploy deve continuar Off até a autorização de deploy.

Comandos preparados para o serviço existente:

```text
Build Command: npm ci --include=dev && npm run prisma:generate && npm run build
Start Command: npm run start:prod
Health Check Path: /health
```

**Conferir o Start Command efetivo no Dashboard:** o comando antigo executava
`prisma:deploy` automaticamente. O YAML desta branch remove essa execução para
separar deploy de migração. Não disparar o deploy com o comando antigo sem uma
autorização que cubra expressamente migrações. Se salvar uma configuração no
Dashboard iniciar deploy, tratar essa ação como parte da autorização de deploy.

### 5. Fazer o deploy autorizado e verificar as rotas

Somente após autorização de deploy, usar Manual Deploy do serviço existente e
selecionar o commit integrado. Não trocar para o repositório do protótipo e não
criar outro banco.

Conferências públicas, sem credenciais:

```text
GET https://unimove-api-jn5z.onrender.com/health                         -> 200
GET https://unimove-api-jn5z.onrender.com/health/ready                   -> 200
GET https://unimove-api-jn5z.onrender.com/api/v1/admin/auth/session       -> 401
GET https://unimove-api-jn5z.onrender.com/api/v1/admin/users              -> 401
```

O `401` anônimo da sessão demonstra que a rota real existe e exige autenticação.
`404` indica versão/rota incorreta; não corrigir isso afrouxando o frontend.

### 6. Garantir os administradores e provisionar MFA

Usar contas existentes dos responsáveis. Se não houver role ADMIN atribuída, a
concessão exige autorização específica do responsável pelo banco; não alterar a
senha nem executar o seed completo para contornar essa etapa. Para um DBA, a
concessão transacional à conta existente pode ser preparada no cliente SQL privado:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(717001::bigint);
-- Substituir somente o e-mail fictício por uma conta existente autorizada.
SELECT set_config('unicarona.admin_email', 'admin@ucb.edu.br', true);
DO $$
DECLARE target_id uuid; admin_role_id uuid;
BEGIN
  SELECT id INTO target_id FROM users
  WHERE institutional_email = current_setting('unicarona.admin_email')
    AND status = 'ACTIVE' AND deleted_at IS NULL
  FOR UPDATE;
  IF target_id IS NULL THEN RAISE EXCEPTION 'Active existing account required'; END IF;
  INSERT INTO roles (id, name) VALUES (gen_random_uuid(), 'ADMIN')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO admin_role_id FROM roles WHERE name = 'ADMIN';
  INSERT INTO user_roles (user_id, role_id) VALUES (target_id, admin_role_id)
    ON CONFLICT DO NOTHING;
  INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata)
  VALUES (gen_random_uuid(), 'ADMIN_ROLE_GRANTED', 'User', target_id::text,
          '{"channel":"authorized_operator"}'::jsonb);
END $$;
COMMIT;
```

Depois, em **terminal local privado** no commit integrado, com a conexão atual e os
mesmos segredos do serviço fornecidos por um mecanismo privado do operador:

```text
cd UniMove-back
npm ci --include=dev
npm run prisma:generate
npm run admin:enroll -- admin@ucb.edu.br
```

A CLI pede a confirmação da identidade por canal confiável, abre uma URL privada
de loopback para o QR e solicita o código do autenticador no mesmo terminal. Não
redirecionar sua saída, gravar a sessão ou guardar códigos no repositório. Guardar
os códigos de recuperação em cofre privado. O Render Free não oferece Shell/SSH;
por isso o procedimento usa o computador confiável do operador, sem trocar as
credenciais do banco. [Limitações do plano](https://render.com/docs/free).

Provisionar pelo menos dois responsáveis antes de divulgar o painel. Uma conta
sem MFA continua sem acesso, mesmo que tenha role ADMIN. Um código TOTP usado na
confirmação não pode ser reutilizado no login imediato: aguardar o próximo código
ou usar um código de recuperação.

### 7. Homologar o painel e o app

- Entrar pelo domínio estável do painel, com senha e MFA. A origem deve constar
  na configuração do backend e o proxy deve apontar para o host correto.
- Conferir cookies Secure, HttpOnly nos tokens, SameSite=Strict e ausência de
  tokens no armazenamento JavaScript. Sair precisa invalidar a sessão.
- Usar apenas contas e registros fictícios autorizados para aprovar um vínculo,
  verificar sua auditoria, exportar CSV e conferir autorização negada a estudante.
- Conferir login/refresh do app, veículo, publicação, busca e reserva. O vínculo
  precisa ser aprovado antes de aparecer na busca.
- Conferir o comportamento dos limites atrás de Vercel + Render com duas sessões
  de teste; não aumentar a confiança no proxy sem verificar a cadeia real.

## Rollback e riscos restantes

- Registrar o SHA e a configuração efetivamente usados antes de publicar. Em
  falha, manter o painel fechado, desativar auto-deploy e voltar ao último backend
  aprovado no mesmo serviço, mediante autorização. O esquema não foi alterado.
- O backend anterior não contém estas proteções administrativas. Se for necessário
  voltar a ele, impedir acesso às ferramentas administrativas durante o rollback.
  Não rotacionar chaves para tentar resolver o rollback: isso pode invalidar fatores.
- O provisionamento não redefine fator ativo. Perda do autenticador e dos códigos
  exige um procedimento controlado de recuperação; manter dois admins reduz esse risco.
- A trava por conta pode ser usada para bloquear o login por 15 minutos. As sessões
  já abertas continuam válidas; o limitador por IP complementa a proteção.
- Checkpoints de tentativas/replay têm retenção indefinida. Uma limpeza futura deve
  atuar apenas nos tipos internos e preservar janelas ativas. Rotacionar a chave
  JWT altera seus fingerprints; nenhuma rotação faz parte desta entrega.
- O teste real de ponta a ponta em Render/Vercel e a conferência da cadeia de IP
  dependem da publicação autorizada. Não foram simulados como uma integração concluída.
- A atualização compatível das dependências zerou os alertas de produção. Existem
  2 alertas baixos e 33 moderados nas ferramentas de desenvolvimento; não foi feita uma
  migração ampla de major versions para eliminá-los nesta entrega.
