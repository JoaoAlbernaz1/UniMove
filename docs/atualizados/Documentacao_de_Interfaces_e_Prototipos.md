# Documentação de interfaces e protótipos

UniMove | Grupo 05 | Universidade Católica de Brasília  
Versão documental 2.0 • 13/11/2026

## Objetivo

Este documento apresenta as telas do UniMove, suas funções, integrações e estados de interação.

O protótipo Figma é mantido como referência visual. As funcionalidades descritas correspondem às interfaces implementadas no aplicativo.

## Estrutura da interface

O aplicativo é React Native/Expo com TypeScript. `UniMove-front/App.tsx` controla as telas por estado. `AuthContext.tsx` gerencia autenticação e chamadas autenticadas. O fluxo exige conclusão do perfil antes da navegação principal. Tema, cores, fontes e componentes reutilizáveis ficam em `src/theme.ts` e `src/components`.

As variantes `.web.tsx`/`.web.ts` adaptam mapa e armazenamento ao navegador. O refresh token usa SecureStore no nativo e localStorage na web. `EXPO_PUBLIC_API_URL` define a API, com padrão `http://localhost:3000/api/v1`; no emulador Android, a configuração pode apontar para `10.0.2.2`. A escolha desse endereço depende do ambiente de execução.

## Telas e contratos

| Área e telas | Conteúdo e ações | Integração principal |
|---|---|---|
| Welcome, Register, Login | Entrada, cadastro, termos, senha/confirmação e autenticação/MFA | `/auth/registration-policy`, `/auth/register`, `/auth/login`, `/auth/refresh` |
| CompleteProfile | Curso, período, Sobre e tags; impede entrada na jornada enquanto incompleto | `/users/me`, `/users/me/profile-policy`, `/users/me/profile` |
| Home | Próximas caronas, atalhos, indicadores, sino e publicidade demonstrativa | `/rides/upcoming`, `/users/me/indicators` |
| SearchRide | Filtros de origem/destino, data/hora; lista paginada e notas do motorista | `/rides` |
| RideDetails | Locais no mapa, veículo, contribuição, preferências, pedido e disponibilidade | `/rides/:id/details`, `/rides/:id/requests` |
| OfferRide | Veículo, locais, data/hora, vagas, contribuição e preferências | `/locations`, `/vehicles`, `POST /rides` |
| RideRequests | Modos motorista/passageiro; lista e estado dos pedidos; aceite/recusa para motorista | `/driver/ride-requests`, `/rides/requests/mine`, `/ride-requests/:id/accept`, `/reject` |
| RegisterVehicle | Cadastro/edição de carro e seleção de foto da CNH | `/vehicles`, `/vehicles/registration-policy`, `/vehicles/driver-license` |
| Messages, Chat | Conversas existentes, contatos elegíveis, mensagens e leitura | `/messages/*`, `/rides/:id/conversations`, Socket.IO `/chat` |
| History | Cartões, resumo de contribuições, filtros locais e mais páginas | `/history`, `/history/summary` |
| Profile | Próprio perfil, edição, conquistas e acesso ao veículo; o parâmetro de navegação não implementa consulta de perfil público | `/users/me`, `/users/me/profile`, `/users/me/achievements` |
| Settings | Atalhos para dados pessoais, privacidade, preferências, ajuda e revisão administrativa | APIs de conta e sessão |
| PersonalInfo + IdentityVerificationWizard | Dados pessoais, foto e envio/acompanhamento do comprovante acadêmico | `/users/me/personal-info`, `/users/me/verification/*` e rotas de foto |
| AdminVerification | Fila acadêmica, dados/GUID e aprovação/rejeição para ADMIN | `/admin/academic-verifications` |
| Notifications | Central com abas, leitura, exclusão e navegação para recurso relacionado | `/notifications`, `/notifications/unread-count` |
| NotificationSettings | Categorias, canais, Não perturbe, telefone e dispositivo push | `/users/me/notification-preferences`, `/users/me/phone`, `/users/me/push-devices` |
| Privacy | Preferências de visibilidade e privacidade | `/users/me/privacy-preferences` |
| HelpCenter | Conteúdo de ajuda e orientações | Conteúdo da tela; não implica central de atendimento externa integrada |

Os caminhos são relativos a `/api/v1`, exceto o namespace Socket.IO. A tabela agrupa contratos; campos exatos e validações estão nos DTOs e nas políticas retornadas pelo servidor.

## Estados e mensagens funcionais

- Carregamento e falha de rede devem acompanhar chamadas remotas; listas vazias não significam falha de autenticação.
- `PROFILE_INCOMPLETE` conduz ao preenchimento do perfil; `ACADEMIC_VERIFICATION_REQUIRED` exige comprovante e aprovação.
- A verificação acadêmica diferencia ausência, `PENDING_REVIEW`, `APPROVED` e `REJECTED`. Rejeição deve mostrar o motivo disponível e permitir correção.
- Oferta e veículo usam políticas do servidor para evitar limites fixos antigos. Capacidade é de 1 a 6 e o ano máximo do veículo muda anualmente.
- Pedidos diferenciam pendência, aceite, recusa e expiração. O servidor é a autoridade sobre vagas e conflitos; `canRequest` e `hasPendingRequest` auxiliam a interface.
- Ausência de avaliações aparece como ausência, não nota zero. Ganhos/gastos no histórico são estimativas, não comprovantes de pagamento.
- Histórico de mensagens pode permanecer disponível após conclusão, mas o envio exige reserva confirmada. Reconexão recupera mensagens pela API.
- A central de notificações é distinta de push/e-mail/SMS. Desativar canal externo não apaga o histórico do app.

## Mapas, documentos e publicidade

`OpenFreeMap.tsx` gera um mapa MapLibre com estilo OpenFreeMap, origem/destino e enquadramento dos pontos. O mapa não exibe telemetria GPS contínua, rota efetivamente percorrida ou rota viária otimizada. O componente apresenta alternativa quando não há coordenadas válidas.

O comprovante acadêmico usa PDF digital de até 5 MB/cinco páginas. O backend extrai e descarta o arquivo, mantendo status e metadados para revisão. O revisor consulta o GUID, sem download do PDF na fila. A CNH usa imagem e não possui aprovação automática ou OCR.

O carrossel usa três peças demonstrativas definidas em `src/content/advertisements.ts`. Não há painel de campanhas, faturamento ou relatório de publicidade. A existência da área visual não comprova anúncio contratado.

## Lacunas de interface

Não foram encontradas telas dedicadas para rastreamento GPS, sustentabilidade/CO2, manutenção de rotas recorrentes, envio de avaliações e ocorrências, nem uma jornada completa para iniciar/concluir/cancelar viagens e reservas. Vários desses comandos existem na API. As mensagens de estado e ajuda não devem ser usadas como evidência de uma ação integrada ausente.

O painel administrativo completo de IAM não está neste checkout. Não há base local para afirmar aparência, responsividade ou implementação das telas desse painel. O aplicativo contém a revisão acadêmica, que é um recorte administrativo.

## Validação e manutenção

Nesta atualização foram conferidas referências de arquivos, rotas e limites no código. Não foram executados testes de interface, acessibilidade, responsividade, aparelhos Android/iOS ou comparação com Figma. Para uma próxima validação visual, registrar dispositivo/viewport, estado da conta, fixture e resultado observado por jornada.

Manter esta documentação em conjunto com o documento de visão, arquitetura e casos de uso. Alterações de políticas de conteúdo, limites de upload, rotas, papéis ou canais devem atualizar a tabela e os estados correspondentes.

Fontes: `UniMove-front/App.tsx`, `src/screens/*`, `src/components/IdentityVerificationWizard.tsx`, `src/components/OpenFreeMap.tsx`, `src/api/*`, `src/auth/*`, `src/notifications.ts`, `src/content/advertisements.ts`; `UniMove-back/src/modules/*` e `src/common/guards/*`.
