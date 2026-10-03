# UniMove Front

App mobile em React Native (Expo SDK 57) e TypeScript. Consome a API REST do `UniMove-back`.

Visual segue o protótipo no Figma Make "UNICARONA Versão nova"; os tokens estão em `src/theme.ts`.

## Rodar

1. Suba o backend (`UniMove-back`, ver o README de lá) em `http://localhost:3000`.
2. Copie `.env.example` para `.env` se precisar mudar a URL da API.
3. `npm install`
4. `npm run web` abre em `http://localhost:8080` — a porta 8080 já está liberada no `CORS_ORIGINS` do backend.
   Para celular, `npm start` e leia o QR code com o Expo Go.

### Celular sem acesso à máquina (EAS Update)

Quando o celular não alcança o computador (rede corporativa, sem túnel), publique o
app no Expo e abra pelo QR code. O projeto está ligado a `@joaoalbernaz1/UniMove-front`.

```
npx expo export --platform android --platform ios --no-bytecode --dump-assetmap --dump-sourcemap --output-dir dist
npx eas-cli@latest update --branch preview --message "<o que mudou>" --environment preview --platform all --skip-bundler --input-dir dist
```

O QR code sai de `https://qr.expo.dev/eas-update?slug=exp&projectId=00d83780-d8c6-4ba2-a2b9-9a9292d36b11&groupId=<group do update>`.
`--no-bytecode` só é necessário onde o `hermesc.exe` é bloqueado; sem ele, `eas update` sozinho
exporta e publica. Login e cadastro falham nesse modo, porque a API continua em `localhost`.

`npm run typecheck` verifica os tipos.

> **npm 12:** `npx expo install <pacote>` grava a versão certa no `package.json`, mas a
> instalação que ele dispara é barrada pelo npm 12 (`EALLOWSCRIPTS`). Rode `npm install`
> logo depois.

## O que já existe

**UC11 – Fazer Login** (ator: Usuário Geral)

- Aceita só e-mail de domínio institucional (UC01 RN04), com a mensagem da especificação.
- Mensagens de erro vêm do backend em português; sem internet, mostra a mensagem do UC01 E03 e mantém os campos preenchidos.
- Sessão persistente: o refresh token fica no armazenamento seguro do celular (`expo-secure-store`; `localStorage` no navegador). Ao abrir o app a sessão é retomada, e o access token (15 min) é renovado sozinho.
- "Sair" revoga a sessão no backend.

**UC01 – Cadastrar Usuário** (tela I01, conectada ao `POST /auth/register` atual)

- Campos que o backend grava: nome completo, CPF (máscara 000.000.000-00), e-mail institucional, senha e confirmação.
- RN01: "Criar conta" só habilita com tudo preenchido. RN02: a senha precisa de 8+ caracteres, maiúscula, minúscula, número e caractere especial — a tela mostra cada requisito sendo cumprido. RN03: CPF com dígitos verificadores. RN04: só domínio institucional.
- A01: CPF ou e-mail já cadastrado mostra a mensagem do backend e oferece "Voltar ao login".
- Passos 12–13: depois de salvar, entra direto e a Home mostra "Cadastro realizado com sucesso!".
- Aceite dos Termos de Uso e da Política de Privacidade, como no Figma: "Criar conta" só habilita com a caixa marcada, e cada link abre o texto. O texto em `src/legal.ts` é provisório, tirado de `UniMove-back/docs/LGPD.md`, e precisa de revisão do grupo.

**Ainda não feito** — dependem de mudanças no backend, que está com outras pessoas:

- UC01 passos 6–10: código por e-mail e reconhecimento facial (a V1 do backend não envia e-mail).
- UC01 tipo de perfil e S01 (veículo): o backend cadastra todo mundo como passageiro; vira motorista ao cadastrar veículo.
- A RN02 é aplicada só no app; o backend aceita qualquer senha com 8+ caracteres.
- Campos do Figma que o backend não guarda (universidade, curso) ficaram de fora.
- O aceite dos termos é exigido só no app; o backend ainda não registra quando nem qual versão foi aceita.
- UC12 – Recuperar Senha: "Esqueceu a senha?" mostra "em construção".

A Home é provisória.

## Estrutura

```
App.tsx                 fontes, AuthProvider e troca Login/Home
src/config.ts           URL da API e domínios aceitos
src/theme.ts            cores, fontes e raios do design
src/validation.ts       regras do UC01 (e-mail, CPF, senha)
src/components/         campo de texto, botão e caixa de mensagem
src/api/                chamadas HTTP (client.ts) e rotas de auth
src/auth/               sessão (AuthContext) e armazenamento do token
src/screens/            telas
```
