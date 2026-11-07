# UniMove Admin IAM — ambiente de homologação seguro

Estado de 07/11/2026. **Nenhuma mudança de produção está autorizada por este documento.**

## Recursos existentes

- Banco vazio, isolado dos dados atuais, criado no projeto Neon já existente `unicarona-admin-homologacao`: `unimove_iam_preview` (branch `main` desse projeto). O banco foi verificado com zero tabelas ao ser criado; não copiar dados de produção.
- Papel PostgreSQL `unimove_iam_app`, com permissões de leitura/escrita limitadas a `unimove_iam_preview`, criado para utilização futura pelo runtime. **Ainda não utilizar essa conta em IAM**: as tabelas IAM têm RLS sem políticas públicas e exigem uma política explícita para o papel de homologação, depois de aplicar as migrations. Sua senha não pertence ao repositório.
- Repositório da API: `JoaoAlbernaz1/UniMove`, branch `feat/admin-iam` (PR #16).
- Serviço Render de homologação **criado sem credenciais**: `unimove-iam-homologacao`, ID `srv-dbnpmpjm8hqs73cs8p2g`, endereço `https://unimove-iam-homologacao.onrender.com`, plano Free, auto-deploy desligado. O primeiro deploy ainda não constitui ambiente funcional enquanto faltarem segredos, migração e configuração do painel.
- Primeiro build Render `dep-dbnpmprm8hqs73cs8png`: `build_failed` por `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL` em `npm run prisma:generate`. É **bloqueio de configuração esperado**, pois o serviço foi deliberadamente criado sem segredos; não representa falha do código validado no CI. Informar `DATABASE_URL` do **banco isolado** nos campos protegidos antes de reexecutar o build. 
- Auditoria NPM do primeiro build informou 35 alertas (2 baixos, 33 moderados). Revisar `npm audit` sem aplicar automaticamente `npm audit fix --force` nem atualizações incompatíveis.
- Repositório do painel: `JoaoAlbernaz1/UniCarona-Admin-MVP`, branch de preview `preview/admin-iam-isolado`, derivada de `feat/admin-iam-contracts` (PR #2).
- **Na branch de preview somente**, `UniMove-admin/vercel.json` não possui rewrite `/api/*` para produção. Até configurar um backend de homologação, operações de API devem falhar de maneira controlada. **Não mesclar esse arquivo de preview na branch de produção sem revisar o proxy.**
- API de produção `https://unimove-api-jn5z.onrender.com` e banco Supabase de produção: NÃO conectar à homologação.

## Backend de homologação no Render

O serviço Render foi criado sem transmitir credenciais; a tentativa anterior de criar e configurar segredos numa única ação foi bloqueada. **Não crie um segundo serviço.** Abra o serviço existente `srv-dbnpmpjm8hqs73cs8p2g` no Render e configure somente os segredos próprios da homologação por meio dos campos protegidos, sem publicá-los neste repositório. A configuração criada foi:

| Campo | Valor |
| --- | --- |
| Nome sugerido | `unimove-iam-homologacao` |
| Repositório | `https://github.com/JoaoAlbernaz1/UniMove` |
| Branch | `feat/admin-iam` |
| Root directory | vazio (comandos incluem `cd UniMove-back`) |
| Runtime | Node 24 |
| Build | `cd UniMove-back && npm ci --include=dev && npm run prisma:generate && npm run build` |
| Start | `cd UniMove-back && npm run start:prod` |
| Auto-deploy | desligado |
| Region | Ohio (próxima ao Neon us-east-1) |

**Segredos só no painel Render**, nunca no GitHub, comentários de PR ou chat:

- `DATABASE_URL`: URL do banco **`unimove_iam_preview`** no console Neon, confirmando o nome do banco antes de salvar.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TWO_FACTOR_ENCRYPTION_KEY`: três valores aleatórios de pelo menos 32 caracteres, exclusivos da homologação (não reutilizar produção).
- `NODE_ENV=production` para cookies HTTPS e validação real de MFA.
- `ALLOWED_INSTITUTIONAL_EMAIL_DOMAINS=ucb.edu.br` ou configuração institucional isolada apropriada.
- `MAIL_PROVIDER=none` até SMTP de homologação configurado.
- `TRUST_PROXY_HOPS=1` quando houver somente um proxy confiável confirmado.
- `ADMIN_PANEL_ORIGINS` e `ADMIN_PANEL_URL`: informar **apenas a origem HTTPS exata do preview** quando estiver disponível. Não usar domínio de produção nem wildcard.
- `CORS_ORIGINS`: restringir à origem específica do preview, quando necessário.

Execute `npm run prisma:deploy` **deliberadamente no banco `unimove_iam_preview`** com a conta proprietária do schema antes de iniciar o backend; valide `_prisma_migrations` e as quatro tabelas IAM. Para executar a API com `unimove_iam_app`, adicione, **somente na base de homologação**, políticas RLS e privilégios específicos para esse papel nas quatro tabelas IAM; sem essas políticas, ele não poderá operar o IAM. Teste o acesso com esse papel antes de configurar o Render. Nunca habilite políticas amplas para `anon` ou `authenticated`. Evite automatizar migração no startup de aplicação: em caso de rollback, ela não deve rodar novamente sem revisão. Confira o campo `DATABASE_URL` antes de migrar e que os usuários/segredos do banco são sintéticos.

Para bootstrap de ADMIN de teste, use o CLI de provisionamento no ambiente isolado com uma identidade sintética e chave MFA da homologação, sem criar administrador em produção. Após inicialização, testar convites e recuperação com caixa de e-mail de teste em provedor transacional sandbox, não com e-mails reais de estudantes.

## Painel Vercel

1. O projeto `unimove` está ligado ao repositório `UniCarona-Admin-MVP`. Seu PR #2 foi bloqueado pelo Vercel porque o autor GitHub `ALJoao` não é membro confirmado do time proprietário.
2. Proprietário: **Vercel → Team Settings → Members**: convidar uma conta Vercel vinculada ao GitHub `ALJoao`, confirmar adesão; não contornar reescrevendo autoria de commits.
3. Com o serviço de homologação disponível, configurar **somente na branch `preview/admin-iam-isolado`** o destino de `/api/:path*` com o HTTPS do backend de homologação, nunca a API real.
4. Fazer deploy **somente Preview**, mantendo Vercel Authentication ativado nos previews. Não usar `--prod`, não promover domínio, não fazer merge.
5. Configurar `ADMIN_PANEL_ORIGINS` no backend com a origem exata do preview, validar CSRF, cookies, 401/403 e a ausência de encaminhamento a produção.

## Ensaios e critérios de aceite

- Banco Neon de homologação, API e frontend separados; nenhuma URL de produção em configurações de proxy do preview.
- `/health` da API de homologação funciona; migração aplicada e RLS+grants testados.
- Login de ADMIN sintético e 2FA funcional; sessões ADMIN pre-migração com escopo APP recusadas, exigindo re-login; sessões APP do estudante não alteradas.
- Convites, senha, reset, MFA, códigos, mudança de fator, permissões, sessão, auditoria, concorrência, erros e expiração usando identidades sintéticas.
- SMTP configurado **somente quando houver provedor de teste**; entrega por e-mail real só com remetente verificado e destinatários de teste.
- Comparação de layout Figma em 390/768/1440 e regressão do dashboard.
- Ensaiar backup/restore e rollback em homologação; CI verde nos dois PRs.
- Só depois considerar publicação, com aprovação separada de migração Supabase, merge dos PRs e deploys Render/Vercel.

## Restrições

Não modificar `UniMove-front`, chaves MFA de produção, sessões reais, credencial PostgreSQL antiga, dados de estudantes, URL da API de produção ou deploys de `main`. A rotação da antiga senha PostgreSQL exige coordenação com o responsável pela conta.
