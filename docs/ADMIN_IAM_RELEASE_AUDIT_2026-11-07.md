# Auditoria de prontidão para publicação — UniMove Admin IAM

Data: 2026-11-07. Revisão independente somente de leitura em ambientes existentes, com correção documental em branch de feature. **Sem merge, deploy, alteração de variável, migração ou SQL de escrita em produção.**

## Atualização da homologação automatizada — 07/11/2026

- [CI backend aprovado](https://github.com/JoaoAlbernaz1/UniMove/actions/runs/42413092903): `npm run prisma:deploy` em PostgreSQL descartável, lint, typecheck, testes unitários, 59 testes administrativos anteriores, **36 testes IAM**, regressão de busca e contratos do aplicativo dos estudantes.
- [CI frontend aprovado](https://github.com/JoaoAlbernaz1/UniCarona-Admin-MVP/actions/runs/42412697031) na branch do PR #2 (lint, typecheck, testes e build).
- Um job `migration-backfill` separado prepara um banco **antes** da migração IAM com ADMIN ativo, ADMIN excluído, estudante e sessão legada, aplica a migration, valida concessão das seis permissões somente ao ADMIN ativo, RLS, ausência de grants de leitura para `anon`/`authenticated`, índices parciais e reaplicação idempotente. [Execução do job](https://github.com/JoaoAlbernaz1/UniMove/actions/runs/42414509787). **Isso não valida rollback por restauração de backup**, que permanece pendente.
- A confirmação de substituição do MFA passou a comparar a versão anterior do fator com o ticket assinado, evitando replay após confirmação. Também revoga outras sessões administrativas. Foram acrescentados testes unitários e teste HTTP de revogação.
- **Risco residual de sessões legadas:** sessões administrativas criadas antes da coluna `scope` ficam com `APP` e não aparecem nas listas/ações que filtram `scope=ADMIN`. O `JwtAuthGuard` verifica se a sessão existe e não foi revogada, mas não exige o escopo `ADMIN`. Por isso, uma sessão administrativa antiga pode continuar válida mesmo quando a interface só mostra sessões `ADMIN`. Definir, antes da publicação, como invalidar sessões antigas de administradores (com re-login MFA), sem revogar arbitrariamente sessões de estudantes. Revogação de sessões com `scope=ADMIN` sozinha não resolve esse cenário.
- A revisão anterior abaixo é um registro histórico; afirmações sobre ausência de testes descartáveis ou falta de proteção contra replay foram superadas por esta atualização. O teste de ponta a ponta entre navegador, backend de homologação e serviço de e-mail real ainda não ocorreu.

## Evidência observada

- Backend [PR #16](https://github.com/JoaoAlbernaz1/UniMove/pull/16), head `46905748292f1b0e2da46688aa3acb3d052af1e0` antes desta revisão: aberto, draft, `mergeable=true`, `mergeable_state=clean`. Checks `backend`, `student-contracts` e `busca` aprovados.
- Painel [PR #2](https://github.com/JoaoAlbernaz1/UniCarona-Admin-MVP/pull/2), head `ec8cd17cfb3cc95d1039a8ad85448ad7bdfbb199`: aberto, draft, `mergeable=true`, `mergeable_state=unstable` (bloqueio Vercel); deployment `dpl_9C2n7GA2eVGjj55WcBBio25YvP3g` = `BLOCKED`.
- Projeto Vercel `unimove` ligado ao repo `UniCarona-Admin-MVP`; Render `unimove-api` ligado ao repo `UniMove`, branch `main`, auto-deploy desligado, deploy live no commit `d1cafbf`.
- Consultas read-only em produção: há 1 administrador não excluído; `public.admin_access` não existe; migração `202611070001_admin_iam` ausente em `_prisma_migrations`. Não há branch Supabase de homologação.
- Nenhum CI GitHub do PR #16 estava em execução na última consulta. Não há acesso ao terminal Windows/Claude Code original; logo, a alegação de que uma shell local antiga foi encerrada NÃO foi verificada.

## Bloqueios identificados

1. **Migração não automática.** O `render.yaml` e a configuração ativa do Render executam `npm run start:prod` (não `prisma migrate deploy`). A documentação inicial estava incorreta. A migration deve ser ensaiada em PostgreSQL isolado e aplicada separadamente, sob aprovação, **antes do backend novo**.
2. **Preview Vercel não isolado.** O `UniMove-admin/vercel.json` da branch do painel encaminha `/api/:path*` para `https://unimove-api-jn5z.onrender.com/api/:path*` (produção). Não utilizar qualquer preview IAM para testes de escrita enquanto o rewrite não apontar EXCLUSIVAMENTE a um backend de homologação alimentado por banco isolado. O preview antigo `demo/interface-preview` usa fixtures e não valida o IAM real.
3. **Deploy do painel bloqueado.** Vercel Pro exige que o autor do commit pertença ao time do projeto e tenha a conta Git vinculada. A equipe consultada tem dois membros (um ainda não confirmado), e não há vínculo confirmado com o autor Git `ALJoao`. O proprietário deve convidar/verificar a associação correta em Team Settings > Members e Git Login Connections; reexecutar o deployment depois.
4. **E-mail indisponível.** `MailService` suporta SMTP via Nodemailer, mas não há credencial de provedor em produção. Render Free bloqueia tráfego de saída SMTP nas portas 25, 465 e 587. Candidato: Resend no plano gratuito, `smtp.resend.com:2587`, `SMTP_SECURE=false` (STARTTLS), `SMTP_USER=resend`, e domínio/remetente verificados. Confirmar que TLS foi negociado e a mensagem chegou em **preview isolado**, sem usar tokens reais. Sem provedor, `delivery=NOT_CONFIGURED` e o link não é entregue.
5. **Base de homologação inexistente.** Sem acesso a uma instância PostgreSQL isolada neste ambiente, não foi possível executar a migração nem um teste E2E novo; a revisão da migration foi **estática**, não uma prova de execução/reversibilidade.
6. **Credencial PostgreSQL exposta previamente.** Rotação somente em janela acordada com o dono do Supabase, atualizando Render e outros consumidores juntos. Nunca incluir a credencial em arquivos, logs, chat ou CI.
7. **Revisões de segurança antes da liberação:** `AdminSecurityService.confirmAuthenticatorReplacement` substitui o fator e audita, mas não encerra outras sessões nem notifica o titular; validar política desejada com testes antes de liberar essa operação. O setup ticket assinado é válido 10 min e não há revogação explícita após confirmação: testar replay dentro da janela. Verificar exposição/RLS/grants das futuras tabelas IAM no schema `public` antes de publicar.

## Conferência estática das operações novas

O `AdminAccountsController` usa `@AdminRoute()` em `GET /admin/security/overview`, `PATCH /admin/security/password`, `POST /admin/security/recovery-codes`, `POST /admin/security/authenticator/start` e `POST /admin/security/authenticator/confirm` — são **cinco endpoints**, cobrindo quatro funcionalidades. Troca de senha valida senha atual; regeneração de códigos e início de troca de autenticador chamam `AdminReauthService`; confirmação utiliza ticket assinado e TOTP do fator novo. Isso é inspeção de código, não teste executado nesta revisão. As rotas de administração de terceiros exigem `AdminPermissionRoute(MANAGE_ADMINS)`. Rotas administrativas legadas permanecem com controle antigo, deliberadamente.

## Roteiro obrigatório para homologação isolada

1. Resolver a autorização Git de `ALJoao` na equipe Vercel. Não mudar autoria de commits para contornar o controle.
2. Provisionar PostgreSQL de testes com esquema inicial e **dados sintéticos**, sem copiar a base de produção nem reutilizar seus segredos; combinar custo/aprovação se for recurso cobrado.
3. Executar migrações existentes, aplicar `202611070001_admin_iam` com `npm run prisma:deploy` em contexto isolado, consultar `_prisma_migrations`, índices parciais, `admin_access` e reexecutar `prisma:deploy` para verificar idempotência. Testar reversão **somente no banco descartável**, por restauração de snapshot e/ou migração reversa revisada.
4. Subir backend **separado** de homologação no Render, branch `feat/admin-iam`, com `DATABASE_URL`, JWT, chave MFA e conta administrativa próprios; URLs, origens e envio de e-mail restritos ao preview. Não usar credenciais de produção.
5. Ajustar a configuração de proxy da **branch/projeto de preview** para encaminhar `/api/*` ao backend de homologação, nunca à URL de produção. Testar em separado que cookies, CSRF e checagem de origem funcionam.
6. Publicar preview somente após isolar o backend, executar smoke/e2e completos com contas fictícias controladas: convite, senha, TOTP, códigos, recuperação, permissões, revogação de sessões e auditoria; incluir casos 403/401/replay/concurrency e falha de SMTP.
7. Validar manualmente layout com Figma Make em 390/768/1440, fluxo de login antigo e diferenças intencionais de `docs/ADMIN_IAM_FIGMA.md`.
8. Não promover preview para produção. Exigir aprovação explícita depois de evidência de E2E.

## Publicação futura (não autorizada nesta etapa)

1. Fazer backup/snapshot verificável e obter concordância do proprietário do Supabase, coordenar janela e plano de retorno.
2. Confirmar PRs/SHAs aprovados, credenciais de e-mail e planos de recuperação de MFA. Corrigir os pontos de segurança identificados, se confirmados, em branches de feature com testes.
3. Executar `prisma migrate deploy` **uma única vez, de modo controlado**, no banco de produção, após revisão e autorização; confirmar `_prisma_migrations`, `admin_access` de cada ADMIN atual, índice parcial e ausência de acesso REST indesejado.
4. Fazer merge aprovado do backend e acionar deploy manual Render (auto-deploy desligado); verificar `/health`, sessão administrativa, permissões, erros e logs sem segredos.
5. Fazer merge e publicar frontend no Vercel; testar login 2FA e operação não destrutiva antes de liberar convites reais.
6. Monitorar métricas e audit logs. Executar rotação coordenada da credencial PostgreSQL em janela própria.

## Recuperação e rollback

- Se migração falhar: **parar a publicação** e recuperar a base a partir de snapshot/plano de DBA, sem tentar apagar tabelas às cegas.
- Se backend novo falhar depois de migração aditiva: reimplantar último deploy Render comprovadamente funcional. **Manter o schema aditivo**, pois a versão anterior não depende das tabelas novas; remoção exige plano próprio de retenção e backup.
- Se frontend falhar: reatribuir o domínio ao deployment Vercel anterior confirmado; não fazer rollback de credenciais ou MFA.
- Se envio de e-mail falhar: desabilitar convites/recovery por configuração do provedor ou fluxo operacional, preservando login e MFA.
- Testar recovery e rollback em homologação antes de publicar em produção.

## Limitações desta revisão

Não foram executados aqui uma instância PostgreSQL descartável, testes IAM E2E, testes de e-mail reais, screenshots do preview integrado, nem comandos na máquina Windows onde o Claude Code trabalhou. Checks verdes são resultados observados no GitHub e resultados locais anteriores foram apenas relatados pela etapa 2.

Referências: `render.yaml`, `UniMove-back/package.json`, `UniMove-back/prisma/migrations/202611070001_admin_iam/migration.sql`, `UniMove-back/src/modules/admin/admin-accounts.controller.ts`, `admin-security.service.ts`, `mail.service.ts`, `UniMove-admin/vercel.json` no PR #2; docs oficiais Render (Free SMTP) e Vercel (Git author team permissions).
