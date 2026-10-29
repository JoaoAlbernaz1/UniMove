# UniMove Front

App mobile em React Native (Expo SDK 57) e TypeScript. Consome a API REST do `UniMove-back`.

Visual segue o protótipo no Figma Make "UNICARONA Versão nova"; os tokens estão em `src/theme.ts`.

## Rodar

1. Suba o backend (`UniMove-back`, ver o README de lá) em `http://localhost:3000`.
2. Copie `.env.example` para `.env` se precisar mudar a URL da API.
3. `npm install`
4. `npm run web` abre em `http://localhost:8080` — a porta 8080 já está liberada no `CORS_ORIGINS` do backend.
   Para celular, `npm start` e leia o QR code com o Expo Go.

### Faixa de publicidade

A área autenticada mantém uma faixa fixa no rodapé, fora da rolagem das páginas,
com três banners em movimento contínuo para a direita. O componente permanece
montado durante a navegação. O layout reserva espaço para a faixa e ajusta o
conteúdo ao teclado, sem sobrepor os botões.

Os três banners vetoriais de demonstração estão configurados em
`src/content/advertisements.ts`. Para usar as imagens definitivas, coloque os
arquivos em `assets/ads/` e defina `image: require('../../assets/ads/anuncio-1.png')`
na entrada correspondente; também é aceito `{ uri: 'https://...' }`. Use imagens
horizontais, preferencialmente na proporção 600 × 88, e atualize `description`
para descrever cada propaganda aos leitores de tela.

A faixa pausa enquanto o usuário mantém o dedo pressionado e retoma ao soltar
(também funciona com o mouse no navegador). O espaço entre os banners é de 4 px.
A preferência por movimento reduzido mantém a faixa pausada, e o movimento é
suspenso quando o app vai para segundo plano.

### Oferecer carona

O cartão **Oferecer carona** da Home abre o formulário baseado no protótipo. A tela
consulta `GET /locations` e `GET /vehicles`, permite escolher de uma a quatro vagas
(respeitando a capacidade do veículo) e publica em `POST /rides`. A conta precisa
ter um veículo ativo cadastrado e o perfil de motorista.

Data e hora são preenchidas em `dd/mm/aaaa` e `HH:mm`, no fuso do dispositivo, e
enviadas em UTC junto com o timezone. O preço é enviado em centavos; `0,00` indica
carona gratuita. Observações e preferências são persistidas com a carona.

O formulário mantém os dados em caso de erro, bloqueia envios simultâneos e só
confirma a publicação depois da resposta da API. Ao concluir, voltar ao início
recarrega as caronas da Home. Sem locais ou veículos, a tela informa o requisito.

Verificações: `npm run typecheck`, `npm test` e `npm run lint`.

### Filtros de busca

Em **Buscar carona**, origem e destino filtram por parte do nome, sem distinguir
maiúsculas ou acentos. Data (`dd/mm/aaaa`) e hora (`HH:mm`) filtram a saída no
horário local do dispositivo, como exibido nos cartões. O horário corresponde ao
minuto exato: `08:00` não inclui `08:30`. A API combina os quatro filtros e atualiza
a lista após uma breve pausa na digitação; apagar um campo remove esse filtro.
A API valida os campos, ordena e pagina os resultados. A tela permite percorrer
todas as páginas, e apresenta a média real de avaliações ou "Sem avaliações".

### Mensagens

Em **Mensagens**, o motorista e o passageiro podem iniciar uma conversa depois que a reserva
for confirmada. O histórico continua disponível após a conclusão da viagem; novas mensagens
só podem ser enviadas enquanto a reserva estiver confirmada. A tela consulta mensagens pela
API REST a cada quatro segundos.

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

- Envia as credenciais à API, que valida e autoriza o acesso à conta.
- Mensagens de erro vêm do backend em português; sem internet, mostra a mensagem do UC01 E03 e mantém os campos preenchidos.
- Sessão persistente: o refresh token fica no armazenamento seguro do celular (`expo-secure-store`; `localStorage` no navegador). Ao abrir o app a sessão é retomada, e o access token (15 min) é renovado sozinho.
- "Sair" revoga a sessão no backend.

**UC01 – Cadastrar Usuário** (tela I01, conectada ao `POST /auth/register` atual)

- A API valida nome, CPF, domínio institucional, força da senha, confirmação e aceite. A senha é armazenada somente como hash; a confirmação não é persistida.
- `GET /auth/registration-policy` fornece requisitos de senha, domínios, textos e versões dos documentos. O frontend apresenta essas informações sem implementar as regras de validação.
- A01: CPF ou e-mail já cadastrado mostra a mensagem do backend e oferece "Voltar ao login".
- Passos 12–13: depois de salvar, entra direto e a Home mostra "Cadastro realizado com sucesso!".
- O frontend envia o aceite e as versões apresentadas. A API rejeita aceite ausente ou versões desatualizadas e registra a data no servidor. Os textos em `UniMove-back/src/modules/auth/registration-documents.ts` são provisórios e precisam de revisão do grupo.

**Ainda não feito** — dependem de mudanças no backend, que está com outras pessoas:

- UC01 passos 6–10: código por e-mail e reconhecimento facial (a V1 do backend não envia e-mail).
- UC01 tipo de perfil e S01 (veículo): o backend cadastra todo mundo como passageiro; vira motorista ao cadastrar veículo.
- Campos do Figma que o backend não guarda (universidade, curso) ficaram de fora.
- UC12 – Recuperar Senha: "Esqueceu a senha?" mostra "em construção".

A Home consulta `GET /rides/upcoming`: a API seleciona as três próximas viagens
do usuário, respeitando o papel de motorista ou a reserva confirmada.

## Estrutura

```
App.tsx                 fontes, AuthProvider e troca Login/Home
src/config.ts           URL da API e domínios aceitos
src/theme.ts            cores, fontes e raios do design
src/validation.ts       máscara de CPF e formatação de dígitos
src/components/         campo de texto, botão e caixa de mensagem
src/api/                chamadas HTTP (client.ts) e rotas de auth
src/auth/               sessão (AuthContext) e armazenamento do token
src/screens/            telas
```
