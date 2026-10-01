# UniMove Front

App mobile em React Native (Expo SDK 57) e TypeScript. Consome a API REST do `UniMove-back`.

Visual segue o protótipo no Figma Make "UNICARONA Versão nova"; os tokens estão em `src/theme.ts`.

## Rodar

1. Suba o backend (`UniMove-back`, ver o README de lá) em `http://localhost:3000`.
2. Copie `.env.example` para `.env` se precisar mudar a URL da API.
3. `npm install`
4. `npm run web` abre em `http://localhost:8080` — a porta 8080 já está liberada no `CORS_ORIGINS` do backend.
   Para celular, `npm start` e leia o QR code com o Expo Go.

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

"Esqueceu a senha?" (UC12) e "Criar nova conta" (UC01) ainda mostram "em construção". A Home é provisória.

## Estrutura

```
App.tsx                 fontes, AuthProvider e troca Login/Home
src/config.ts           URL da API e domínios aceitos
src/theme.ts            cores, fontes e raios do design
src/api/                chamadas HTTP (client.ts) e rotas de auth
src/auth/               sessão (AuthContext) e armazenamento do token
src/screens/            telas
```
