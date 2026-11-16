/**
 * Contratos da gestão de identidade administrativa: convites, permissões,
 * sessões, redefinição de senha e recuperação do segundo fator.
 *
 * Arquivo separado de `api.ts` de propósito: aquele descreve o painel que já
 * existe, este descreve as rotas novas que as telas do Figma vão consumir.
 * Nenhuma tela usa estes tipos ainda.
 */

export type AdminPermission =
  | "MANAGE_ADMINS"
  | "MANAGE_USERS"
  | "REVIEW_VERIFICATIONS"
  | "MODERATE_INCIDENTS"
  | "VIEW_REPORTS"
  | "VIEW_AUDIT"

/** Catálogo servido por `GET /admin/permissions`: rótulo e texto vêm da API. */
export type AdminPermissionInfo = {
  value: AdminPermission
  label: string
  description: string
  /** Concede poder sobre outros administradores. A tela deve destacar. */
  sensitive: boolean
}

/**
 * Situação derivada pelo servidor. `PENDING_ACTIVATION` é quem tem o papel mas
 * ainda não confirmou o autenticador: não consegue entrar no painel.
 */
export type AdminAccountState =
  | "ACTIVE"
  | "PENDING_ACTIVATION"
  | "SUSPENDED"
  | "BLOCKED"

export type AdminAccountRow = {
  id: string
  fullName: string
  email: string
  state: AdminAccountState
  twoFactorEnabled: boolean
  recoveryCodesRemaining: number
  permissions: AdminPermission[]
  permissionsUpdatedAt: string | null
  activeSessions: number
  createdAt: string
}

export type AdminAccountList = {
  items: AdminAccountRow[]
  total: number
  /** Vazio nestas rotas; existe para o tipo bater com as listas antigas. */
  statusCounts: Record<string, number>
  /** Convites em aberto, para o contador ao lado da lista. */
  pendingInvites: number
}

export type AdminInviteStatus = "PENDING" | "ACCEPTED" | "REVOKED"

export type AdminInviteRow = {
  id: string
  email: string
  fullName: string
  permissions: AdminPermission[]
  status: AdminInviteStatus
  expiresAt: string
  /** Quando o destinatário abriu o link: prova de controle do endereço. */
  emailConfirmedAt: string | null
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
  invitedBy: { id: string; fullName: string }
  revokedBy: { id: string; fullName: string } | null
  userId: string | null
  /** Pendente com prazo vencido. O servidor calcula; não existe coluna. */
  expired: boolean
}

/** Resultado do envio. Diferente de `SENT`, o convite existe mas não chegou. */
export type MailDelivery = "SENT" | "NOT_CONFIGURED" | "FAILED"

export type CreateInviteInput = {
  email: string
  fullName: string
  permissions: AdminPermission[]
}

export type CreateInviteResult = {
  invite: {
    id: string
    email: string
    fullName: string
    permissions: AdminPermission[]
    status: AdminInviteStatus
    expiresAt: string
  }
  delivery: MailDelivery
}

/**
 * Reautenticação (step-up) exigida em toda operação que muda quem tem acesso.
 * Vai no corpo do pedido: a tela pede senha e código no mesmo passo.
 *
 * Atenção ao fluxo: o autenticador mostra o mesmo número por 30 segundos e o
 * servidor não aceita o mesmo código duas vezes. Quem acabou de entrar recebe
 * `ADMIN_REAUTH_CODE_ALREADY_USED` e precisa esperar o próximo código — a tela
 * deve dizer isso, não "código inválido".
 */
export type ReauthInput = {
  password: string
  twoFactorCode: string
}

export type UpdatePermissionsInput = ReauthInput & {
  permissions: AdminPermission[]
  reason: string
}

export type UpdatePermissionsResult = {
  id: string
  permissions: AdminPermission[]
  permissionsUpdatedAt: string
}

export type RevokeAccessInput = ReauthInput & { reason: string }

// ---------------------------------------------------------------- aceite

/** Passo 4: o convite é válido e o endereço foi confirmado ao abrir o link. */
export type InvitePreview = {
  email: string
  fullName: string
  permissions: AdminPermission[]
  expiresAt: string
  /**
   * Já existe conta de plataforma com este e-mail. Nesse caso o aceite pede a
   * senha atual e não define outra: o convite nunca troca senha de estudante.
   */
  accountExists: boolean
}

export type AcceptInvitePasswordInput = {
  token: string
  /** Conta nova: CPF e senha. */
  cpf?: string
  password?: string
  /** Conta existente: apenas a senha atual. */
  currentPassword?: string
}

/** Dados para cadastrar o autenticador. Exibidos uma única vez. */
export type TwoFactorProvisioning = {
  twoFactor: {
    secret: string
    otpauthUri: string
    /** PNG em data URI, pronto para `<img src>`. */
    qrCode: string
    issuer: string
  }
}

export type AcceptInviteResult = {
  activated: true
  inviteId: string
  /** Exibidos uma única vez. Não há endpoint para consultá-los depois. */
  recoveryCodes: string[]
}

// -------------------------------------------------------- senha e fator

/** Resposta deliberadamente igual para conta existente e inexistente. */
export type NeutralRequestResult = { accepted: true; message: string }

export type ConfirmPasswordResetResult = {
  updated: true
  /** Sempre verdadeiro: redefinir senha não desativa o segundo fator. */
  twoFactorStillRequired: true
}

export type AdminRecoveryStatus =
  | "PENDING"
  | "APPROVED"
  | "COMPLETED"
  | "REJECTED"

export type AdminRecoveryRow = {
  id: string
  status: AdminRecoveryStatus
  reason: string
  expiresAt: string
  reviewedAt: string | null
  reviewNote: string | null
  completedAt: string | null
  createdAt: string
  user: { id: string; fullName: string; institutionalEmail: string }
  reviewedBy: { id: string; fullName: string } | null
  expired: boolean
}

export type RequestMfaRecoveryInput = {
  email: string
  /** Obrigatória: só o acesso ao e-mail não derruba o segundo fator. */
  password: string
  reason: string
}

export type ReviewMfaRecoveryInput = ReauthInput & {
  approve: boolean
  note?: string
}

export type ReviewMfaRecoveryResult = {
  reviewed: true
  approved: boolean
  delivery: MailDelivery
}

export type ConfirmMfaRecoveryResult = {
  completed: true
  recoveryCodes: string[]
}

// ------------------------------------------------------------- sessões

export type AdminSessionRow = {
  id: string
  userAgent: string | null
  createdAt: string
  expiresAt: string
  /** A sessão deste navegador. Não pode ser encerrada pela lista: use Sair. */
  current: boolean
}

export type AdminSessionList = { items: AdminSessionRow[]; total: number }

export type RevokeSessionsResult = { revoked: number }

// ------------------------------------------- segurança da própria conta

/** `GET /admin/security/overview`: o que "Minha conta" e "Segurança" mostram. */
export type AdminSecurityOverview = {
  account: {
    id: string
    fullName: string
    email: string
    status: "ACTIVE" | "SUSPENDED" | "BLOCKED" | "DEACTIVATED"
    roles: string[]
    permissions: AdminPermission[]
    permissionsUpdatedAt: string | null
    createdAt: string
  }
  twoFactor: {
    enabled: boolean
    recoveryCodesRemaining: number
    recoveryCodesTotal: number
    issuer: string
    /** Null quando não há registro: a tela diz isso, não inventa data. */
    boundAt: string | null
  }
  password: {
    /** Null quando a senha nunca foi trocada por aqui. */
    changedAt: string | null
  }
  sessions: {
    active: number
    others: number
    currentStartedAt: string | null
    currentUserAgent: string | null
  }
  lastLoginAt: string | null
  sessionMaxHours: number
}

export type ChangeOwnPasswordInput = {
  currentPassword: string
  password: string
}

export type ChangeOwnPasswordResult = {
  updated: true
  /** Quantas outras sessões caíram. A atual é preservada. */
  sessionsRevoked: number
  delivery: MailDelivery
}

export type RegenerateRecoveryCodesResult = {
  recoveryCodes: string[]
  remaining: number
}

/**
 * O autenticador novo vive num ticket assinado até ser confirmado: o fator
 * atual só é substituído quando o código novo confere, então desistir no meio
 * não tranca ninguém fora do painel.
 */
export type StartAuthenticatorResult = TwoFactorProvisioning & {
  setupTicket: string
  expiresInMs: number
}

export type ConfirmAuthenticatorResult = {
  replaced: true
  recoveryCodes: string[]
}

// --------------------------------------------- trilha de auditoria

export type AuditEntryRow = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  actor: { id: string; fullName: string } | null
}

export type SecurityHistoryFilters = {
  page?: number
  q?: string
  action?: string
  from?: string
  to?: string
}
