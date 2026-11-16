import type {
  IncidentStatus,
  IncidentType,
  ReservationStatus,
  RideRequestStatus,
  RideStatus,
  RoleName,
  UserStatus,
  VerificationStatus,
} from "../types/api"

export const userStatusLabel: Record<UserStatus, string> = {
  ACTIVE: "Ativa",
  SUSPENDED: "Suspensa",
  BLOCKED: "Bloqueada",
  DEACTIVATED: "Excluída",
}

export const roleLabel: Record<RoleName, string> = {
  PASSENGER: "Passageiro",
  DRIVER: "Motorista",
  ADMIN: "Administrador",
}

export const verificationLabel: Record<VerificationStatus, string> = {
  PENDING_REVIEW: "Pendente",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
}

export const rideStatusLabel: Record<RideStatus, string> = {
  OPEN: "Aberta",
  SCHEDULED: "Agendada",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
}

export const requestStatusLabel: Record<RideRequestStatus, string> = {
  PENDING: "Pendente",
  ACCEPTED: "Aceita",
  REJECTED: "Recusada",
  EXPIRED: "Expirada",
  CANCELLED: "Cancelada",
}

export const reservationStatusLabel: Record<ReservationStatus, string> = {
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  COMPLETED: "Concluída",
  NO_SHOW: "Não compareceu",
}

export const incidentStatusLabel: Record<IncidentStatus, string> = {
  OPEN: "Aberta",
  UNDER_REVIEW: "Em análise",
  RESOLVED: "Resolvida",
  DISMISSED: "Arquivada",
}

export const incidentTypeLabel: Record<IncidentType, string> = {
  INAPPROPRIATE_BEHAVIOR: "Comportamento inadequado",
  NO_SHOW: "Ausência no embarque",
  VEHICLE_ISSUE: "Problema no veículo",
  SAFETY_CONCERN: "Preocupação de segurança",
  OTHER: "Outros",
}

const auditActions: Record<string, string> = {
  LOGIN: "Login no app",
  USER_REGISTERED: "Novo cadastro",
  PASSWORD_CHANGED: "Senha alterada",
  USER_ACCOUNT_DELETED: "Conta excluída",
  ACADEMIC_VERIFICATION_SUBMITTED: "Comprovante enviado",
  ACADEMIC_VERIFICATION_APPROVED: "Vínculo aprovado",
  ACADEMIC_VERIFICATION_REJECTED: "Vínculo rejeitado",
  ADMIN_USER_ACTIVE: "Conta reativada",
  ADMIN_USER_SUSPENDED: "Conta suspensa",
  ADMIN_USER_BLOCKED: "Conta bloqueada",
  ADMIN_USER_DEACTIVATED: "Conta desativada",
  INCIDENT_UPDATED: "Denúncia atualizada",
  ADMIN_LOGIN: "Login no painel",
  ADMIN_LOGOUT: "Saída do painel",
  ADMIN_LOGIN_FAILED: "Falha de login no painel",
  ADMIN_ACCESS_DENIED: "Acesso ao painel negado",
  ADMIN_2FA_FAILED: "Falha no segundo fator",
  ADMIN_2FA_ENROLLED: "Autenticador cadastrado",
  ADMIN_RECOVERY_CODE_USED: "Código de recuperação usado",
  ADMIN_SESSION_REUSE_DETECTED: "Reuso de sessão detectado",
  ADMIN_REPORT_EXPORTED: "Relatório exportado",
  // Gestão de identidade administrativa.
  ADMIN_2FA_ENROLLMENT_STARTED: "Cadastro de autenticador iniciado",
  ADMIN_2FA_REPLACEMENT_STARTED: "Substituição de autenticador iniciada",
  ADMIN_2FA_REPLACED: "Autenticador substituído",
  ADMIN_2FA_RESET_BY_OPERATOR: "Autenticador reiniciado por operador",
  ADMIN_RECOVERY_CODES_REGENERATED: "Códigos de recuperação regerados",
  ADMIN_REAUTH_FAILED: "Falha na reautenticação",
  ADMIN_INVITE_CREATED: "Convite emitido",
  ADMIN_INVITE_EMAIL_FAILED: "Falha no envio do convite",
  ADMIN_INVITE_EMAIL_CONFIRMED: "Endereço do convite confirmado",
  ADMIN_INVITE_PASSWORD_SET: "Senha definida pelo convite",
  ADMIN_INVITE_ACCEPTED: "Convite aceito e acesso concedido",
  ADMIN_INVITE_REVOKED: "Convite revogado",
  ADMIN_PERMISSIONS_CHANGED: "Permissões administrativas alteradas",
  ADMIN_ACCESS_REVOKED: "Acesso administrativo encerrado",
  ADMIN_PASSWORD_CHANGED: "Senha administrativa alterada",
  ADMIN_PASSWORD_RESET_REQUESTED: "Redefinição de senha solicitada",
  ADMIN_PASSWORD_RESET_COMPLETED: "Senha redefinida por link",
  ADMIN_MFA_RECOVERY_REQUESTED: "Recuperação de autenticador solicitada",
  ADMIN_MFA_RECOVERY_APPROVED: "Recuperação de autenticador aprovada",
  ADMIN_MFA_RECOVERY_REJECTED: "Recuperação de autenticador recusada",
  ADMIN_MFA_RECOVERY_STARTED: "Recuperação de autenticador em andamento",
  ADMIN_MFA_RECOVERY_COMPLETED: "Recuperação de autenticador concluída",
  ADMIN_SESSION_REVOKED: "Sessão encerrada",
  ADMIN_SESSIONS_REVOKED_OTHERS: "Outras sessões encerradas",
  ADMIN_SESSIONS_REVOKED_BY_MANAGER: "Sessões encerradas por um gestor",
}

/** Ação nova sem rótulo aparece com o nome técnico, nunca some da auditoria. */
export const auditActionLabel = (action: string) =>
  auditActions[action] ?? action

const auditDetailLabels: Record<string, string> = {
  reason: "Motivo",
  reviewNote: "Observação da revisão",
  note: "Justificativa",
  status: "Situação",
  previousStatus: "Situação anterior",
  ridesCancelled: "Caronas canceladas",
  reservationsCancelled: "Reservas canceladas",
  requestsCancelled: "Solicitações canceladas",
  remaining: "Códigos restantes",
  days: "Período (dias)",
  rows: "Linhas exportadas",
  truncated: "Exportação limitada",
  permissions: "Permissões",
  previous: "Permissões anteriores",
  email: "E-mail",
  delivery: "Entrega do e-mail",
  expiresAt: "Validade",
  sessionsRevoked: "Sessões encerradas",
  sessionId: "Sessão",
  subjectUserId: "Conta do pedido",
  issued: "Códigos emitidos",
  accountCreated: "Conta criada pelo convite",
  count: "Quantidade",
  channel: "Canal",
}

export const auditDetailLabel = (key: string) =>
  auditDetailLabels[key] ?? key
