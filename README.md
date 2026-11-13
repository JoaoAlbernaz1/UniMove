# UniMove

> Plataforma de caronas solidárias para a comunidade acadêmica da Universidade Católica de Brasília (UCB).

**Universidade Católica de Brasília — Análise e Projeto de Software — 2026**

## Sobre o projeto

O UniMove conecta estudantes que oferecem caronas a estudantes que procuram
transporte até o campus. O projeto é composto por um aplicativo multiplataforma
e uma API REST com banco de dados PostgreSQL.

Entre os recursos implementados estão cadastro e autenticação, perfil de usuário,
cadastro de veículo e habilitação de motorista, busca e oferta de caronas,
solicitações e reservas, mensagens, notificações e validação acadêmica por
comprovante. A validação acadêmica depende de revisão administrativa; o projeto
não implementa reconhecimento facial.

## Arquitetura

| Camada | Tecnologia |
| --- | --- |
| Frontend | React Native, Expo SDK 58 e TypeScript |
| Backend | NestJS 11, Node.js 24 e TypeScript |
| Banco de dados | PostgreSQL 17 |
| ORM e migrações | Prisma 7 |
| Comunicação | API REST (JSON) e Socket.IO/WebSocket para conversas |

## Executar localmente

### Pré-requisitos

- Node.js 24.x e npm
- Docker Desktop (para executar o PostgreSQL local)
- Expo Go para testar em um celular, ou um emulador Android/iOS

Os comandos abaixo usam PowerShell e devem ser executados a partir da raiz do
repositório, salvo quando indicado. Mantenha o backend e o frontend rodando em
terminais separados.

### 1. Preparar e iniciar o backend

```powershell
cd UniMove-back
Copy-Item .env.example .env
```

Abra `UniMove-back/.env` e substitua `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET`
por valores aleatórios distintos, com pelo menos 32 caracteres cada. O arquivo
de exemplo já aponta para o PostgreSQL local do Docker Compose.

Inicie o banco e prepare a API:

```powershell
docker compose up -d postgres
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

O backend estará disponível em `http://localhost:3000`. A documentação Swagger
fica em `http://localhost:3000/docs` e o health check em
`http://localhost:3000/health`.

### 2. Preparar e iniciar o frontend

Em outro terminal, na raiz do repositório:

```powershell
cd UniMove-front
npm ci
```

Para executar no navegador:

```powershell
npm run web
```

Abra `http://localhost:8080`. A configuração padrão do app aponta para a API
em `http://localhost:3000/api/v1`; a origem do navegador na porta 8080 já está
incluída no `CORS_ORIGINS` do `.env.example` do backend.

Para executar no celular ou emulador:

```powershell
npm start
```

Leia o QR code com o Expo Go, ou escolha o emulador no menu do Expo. O dispositivo
precisa alcançar o computador que está rodando o backend:

- **Celular físico:** crie `UniMove-front/.env` a partir de `.envexample` e
  substitua `IPDOSEUPC` pelo endereço IP local do computador, por exemplo
  `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000/api/v1`. O celular e o computador
  devem estar na mesma rede.
- **Emulador Android:** configure no `UniMove-front/.env`
  `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api/v1`.
- **Navegador e emulador iOS local:** a URL padrão `localhost` normalmente
  funciona; personalize-a se necessário.

Depois de alterar a URL, reinicie o Expo para que a variável de ambiente seja
carregada. Se o celular não conseguir conectar, confira a rede local e se o
firewall permite conexões à porta 3000.

### Encerrar o banco

Na pasta `UniMove-back`, pare o container sem apagar os dados:

```powershell
docker compose stop postgres
```

### Verificações

Com as dependências instaladas, os testes do frontend podem ser executados com
`npm test` na pasta `UniMove-front`. Os comandos de teste e validação do backend
estão descritos em `UniMove-back/README.md`.

## Documentação

| Documento | Link |
| --- | --- |
| Especificação dos casos de uso | [Google Docs](https://docs.google.com/document/d/1yODVtw9hHyY5FSUCa7P8aLDSWaZnLDw6qFGL2goDdGM/edit?usp=sharing) |
| Documento de visão | [PDF](docs/documento_visão.pdf) |
| Documentação da API e funcionalidades | [README do backend](UniMove-back/README.md) |
| Detalhes do aplicativo | [README do frontend](UniMove-front/README.md) |
| Diagrama de casos de uso | [Imagem](diagramas/UniCarona_casos_de_uso.png) |

---

**Grupo 05 — Universidade Católica de Brasília — Análise e Projeto de Software — 2026**
