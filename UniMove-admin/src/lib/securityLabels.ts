import type { StatusTone } from "../components/ui"
import type {
  AdminAccountState,
  AdminInviteStatus,
  AdminRecoveryStatus,
} from "../types/admin-iam"

/**
 * Rótulos das telas de acesso e segurança.
 *
 * O texto das ações de auditoria **não** mora aqui: `auditActionLabel` e
 * `auditDetailLabel` em `labels.ts` já cobriam os eventos do painel e foram
 * estendidos com os novos. Duplicar o mapa deixaria a mesma ação com dois
 * nomes diferentes em duas telas.
 */

/** Eventos oferecidos no filtro, na ordem em que fazem sentido para quem lê. */
export const AUDIT_FILTER_ACTIONS = [
  "ADMIN_LOGIN",
  "ADMIN_LOGIN_FAILED",
  "ADMIN_2FA_FAILED",
  "ADMIN_REAUTH_FAILED",
  "ADMIN_INVITE_CREATED",
  "ADMIN_INVITE_ACCEPTED",
  "ADMIN_INVITE_REVOKED",
  "ADMIN_PERMISSIONS_CHANGED",
  "ADMIN_ACCESS_REVOKED",
  "ADMIN_PASSWORD_CHANGED",
  "ADMIN_PASSWORD_RESET_COMPLETED",
  "ADMIN_2FA_REPLACED",
  "ADMIN_RECOVERY_CODES_REGENERATED",
  "ADMIN_MFA_RECOVERY_REQUESTED",
  "ADMIN_MFA_RECOVERY_APPROVED",
  "ADMIN_SESSION_REVOKED",
  "ADMIN_SESSIONS_REVOKED_OTHERS",
] as const

/** Falha e recusa aparecem com tom de alerta; o resto é registro normal. */
export function auditTone(action: string): StatusTone {
  if (/FAILED|DENIED|REJECTED|REUSE_DETECTED/.test(action)) return "red"
  if (/REVOKED|RESET_BY_OPERATOR|RECOVERY_REQUESTED/.test(action)) return "amber"
  if (/LOGIN$|ACCEPTED|ENROLLED|COMPLETED|REPLACED|REGENERATED/.test(action))
    return "green"
  return "gray"
}

/** Resumo do desfecho, para a coluna "Resultado" da trilha. */
export function auditResultLabel(action: string) {
  if (/FAILED|DENIED|REJECTED/.test(action)) return "Recusado"
  if (/REUSE_DETECTED/.test(action)) return "Alerta"
  if (/REVOKED|RESET_BY_OPERATOR/.test(action)) return "Revogado"
  if (/REQUESTED|STARTED/.test(action)) return "Em andamento"
  return "Concluído"
}

export const ACCOUNT_STATE_LABEL: Record<AdminAccountState, string> = {
  ACTIVE: "Ativo",
  PENDING_ACTIVATION: "Ativação pendente",
  SUSPENDED: "Conta suspensa",
  BLOCKED: "Conta bloqueada",
}

export const ACCOUNT_STATE_TONE: Record<AdminAccountState, StatusTone> = {
  ACTIVE: "green",
  PENDING_ACTIVATION: "amber",
  SUSPENDED: "amber",
  BLOCKED: "red",
}

export const INVITE_STATUS_LABEL: Record<AdminInviteStatus, string> = {
  PENDING: "Convite pendente",
  ACCEPTED: "Convite aceito",
  REVOKED: "Convite revogado",
}

export const INVITE_STATUS_TONE: Record<AdminInviteStatus, StatusTone> = {
  PENDING: "amber",
  ACCEPTED: "green",
  REVOKED: "gray",
}

export const RECOVERY_STATUS_LABEL: Record<AdminRecoveryStatus, string> = {
  PENDING: "Aguardando revisão",
  APPROVED: "Aprovada",
  COMPLETED: "Concluída",
  REJECTED: "Recusada",
}

export const RECOVERY_STATUS_TONE: Record<AdminRecoveryStatus, StatusTone> = {
  PENDING: "amber",
  APPROVED: "blue",
  COMPLETED: "green",
  REJECTED: "red",
}

/**
 * Atalhos de permissão, só na interface. O servidor não conhece "perfis": a
 * autorização é pela lista de permissões, e é ela que fica gravada. Isto existe
 * porque escolher seis caixas uma a uma é pior do que partir de um conjunto
 * conhecido — depois de aplicar, as caixas continuam sendo a verdade.
 */
export const PERMISSION_PRESETS = [
  {
    id: "operacao",
    label: "Operação",
    description: "Cuida de contas de estudante, validação cadastral e relatórios.",
    permissions: ["MANAGE_USERS", "REVIEW_VERIFICATIONS", "VIEW_REPORTS"],
  },
  {
    id: "seguranca",
    label: "Segurança e moderação",
    description: "Analisa denúncias e acompanha a trilha de auditoria.",
    permissions: ["MODERATE_INCIDENTS", "VIEW_AUDIT", "VIEW_REPORTS"],
  },
  {
    id: "verificacao",
    label: "Validação cadastral",
    description: "Apenas aprova ou recusa o vínculo acadêmico dos estudantes.",
    permissions: ["REVIEW_VERIFICATIONS"],
  },
  {
    id: "completo",
    label: "Acesso completo",
    description: "Inclui gerenciar administradores, convites e recuperações.",
    permissions: [
      "MANAGE_ADMINS",
      "MANAGE_USERS",
      "REVIEW_VERIFICATIONS",
      "MODERATE_INCIDENTS",
      "VIEW_REPORTS",
      "VIEW_AUDIT",
    ],
  },
] as const
