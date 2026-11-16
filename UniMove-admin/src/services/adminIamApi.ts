import { PAGE_SIZE } from "../config"
import type {
  AcceptInviteResult,
  AdminSecurityOverview,
  AuditEntryRow,
  ChangeOwnPasswordInput,
  ChangeOwnPasswordResult,
  ConfirmAuthenticatorResult,
  RegenerateRecoveryCodesResult,
  SecurityHistoryFilters,
  StartAuthenticatorResult,
  AcceptInvitePasswordInput,
  AdminAccountList,
  AdminAccountRow,
  AdminInviteRow,
  AdminInviteStatus,
  AdminPermissionInfo,
  AdminRecoveryRow,
  AdminRecoveryStatus,
  AdminSessionList,
  ConfirmMfaRecoveryResult,
  ConfirmPasswordResetResult,
  CreateInviteInput,
  CreateInviteResult,
  InvitePreview,
  NeutralRequestResult,
  ReauthInput,
  RequestMfaRecoveryInput,
  RevokeAccessInput,
  RevokeSessionsResult,
  ReviewMfaRecoveryInput,
  ReviewMfaRecoveryResult,
  TwoFactorProvisioning,
  UpdatePermissionsInput,
  UpdatePermissionsResult,
} from "../types/admin-iam"
import { request, requestPublic } from "./http"

/**
 * Cliente das rotas de gestão de identidade administrativa.
 *
 * Mesmas convenções de `adminApi.ts`: lista vem como array no corpo e o total
 * no cabeçalho `X-Total-Count`; escrita usa cookie de sessão e CSRF, que
 * `request` já cuida. As rotas sob `/admin/auth/...` são públicas por natureza
 * (quem aceita convite ou recupera acesso ainda não tem sessão) e por isso
 * passam por `requestPublic`, sem a renovação automática de sessão.
 *
 * Nenhuma tela consome este módulo ainda: ele existe para a implementação do
 * design aprovado começar sem reescrever contratos.
 */

type Params = Record<string, string | number | undefined>

function query(params: Params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ""
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

/**
 * Mesmo formato que `adminApi.list` devolve, para as listas novas poderem usar
 * o `ListView` que já existe: array no corpo, total no cabeçalho.
 */
async function listWithTotal<T>(path: string, params: Params = {}) {
  const { data, headers } = await request<T[]>(
    `${path}${query({ limit: PAGE_SIZE, ...params })}`,
  )
  return {
    items: data,
    total: Number(headers.get("X-Total-Count") ?? data.length),
    // Estas rotas não devolvem contagem por situação; o campo existe para o
    // tipo bater com o das listas antigas.
    statusCounts: {} as Record<string, number>,
    headers,
  }
}

/** Rótulos e descrições das permissões vêm da API: a tela não repete texto. */
export const permissionsApi = {
  catalog: async () =>
    (await request<{ items: AdminPermissionInfo[] }>("/admin/permissions")).data
      .items,
}

export const adminAccountsApi = {
  list: async (params: { page?: number; q?: string } = {}) => {
    const { items, total, statusCounts, headers } =
      await listWithTotal<AdminAccountRow>("/admin/admins", params)
    const result: AdminAccountList = {
      items,
      total,
      statusCounts,
      pendingInvites: Number(headers.get("X-Pending-Invites") ?? 0),
    }
    return result
  },
  updatePermissions: async (id: string, input: UpdatePermissionsInput) =>
    (
      await request<UpdatePermissionsResult>(
        `/admin/admins/${id}/permissions`,
        json("PATCH", input),
      )
    ).data,
  /**
   * Encerra o acesso ao painel sem excluir a conta da plataforma. Suspender ou
   * bloquear a conta inteira continua sendo `usersApi.changeStatus`, que trata
   * caronas e reservas em aberto.
   */
  revokeAccess: async (id: string, input: RevokeAccessInput) =>
    (await request<{ revoked: true }>(`/admin/admins/${id}/revoke`, json("POST", input)))
      .data,
  sessionsOf: async (id: string) =>
    (await request<AdminSessionList>(`/admin/admins/${id}/sessions`)).data,
  revokeSessionsOf: async (id: string, input: ReauthInput) =>
    (
      await request<RevokeSessionsResult>(
        `/admin/admins/${id}/sessions/revoke`,
        json("POST", input),
      )
    ).data,
}

export const invitesApi = {
  list: (params: { page?: number; status?: AdminInviteStatus; q?: string } = {}) =>
    listWithTotal<AdminInviteRow>("/admin/invites", params),
  create: async (input: CreateInviteInput) =>
    (await request<CreateInviteResult>("/admin/invites", json("POST", input))).data,
  revoke: async (id: string) =>
    (await request<{ revoked: true }>(`/admin/invites/${id}/revoke`, json("POST")))
      .data,
}

/** Passos do aceite, executados por quem ainda não tem sessão no painel. */
export const inviteAcceptanceApi = {
  /** Abrir o link confirma o endereço e devolve o que o convite concede. */
  confirmEmail: (token: string) =>
    requestPublic<InvitePreview>(
      "/admin/auth/invites/confirm-email",
      json("POST", { token }),
    ),
  setPassword: (input: AcceptInvitePasswordInput) =>
    requestPublic<TwoFactorProvisioning>(
      "/admin/auth/invites/password",
      json("POST", input),
    ),
  /** Último passo: confirma o código, concede o acesso e entrega os códigos. */
  confirmTwoFactor: (token: string, code: string) =>
    requestPublic<AcceptInviteResult>(
      "/admin/auth/invites/two-factor",
      json("POST", { token, code }),
    ),
}

export const passwordResetApi = {
  /** Resposta igual para conta existente e inexistente, por desenho. */
  request: (email: string) =>
    requestPublic<NeutralRequestResult>(
      "/admin/auth/password-reset",
      json("POST", { email }),
    ),
  confirm: (token: string, password: string) =>
    requestPublic<ConfirmPasswordResetResult>(
      "/admin/auth/password-reset/confirm",
      json("POST", { token, password }),
    ),
}

export const mfaRecoveryApi = {
  /** Exige a senha: só o acesso ao e-mail não derruba o segundo fator. */
  request: (input: RequestMfaRecoveryInput) =>
    requestPublic<NeutralRequestResult>(
      "/admin/auth/mfa-recovery",
      json("POST", input),
    ),
  /** Invalida o autenticador atual e provisiona o novo. Pede a senha de novo. */
  start: (token: string, password: string) =>
    requestPublic<TwoFactorProvisioning>(
      "/admin/auth/mfa-recovery/start",
      json("POST", { token, password }),
    ),
  confirm: (token: string, code: string) =>
    requestPublic<ConfirmMfaRecoveryResult>(
      "/admin/auth/mfa-recovery/confirm",
      json("POST", { token, code }),
    ),
  /** Fila de revisão. Requer MANAGE_ADMINS. */
  list: (params: { page?: number; status?: AdminRecoveryStatus } = {}) =>
    listWithTotal<AdminRecoveryRow>("/admin/mfa-recoveries", params),
  review: async (id: string, input: ReviewMfaRecoveryInput) =>
    (
      await request<ReviewMfaRecoveryResult>(
        `/admin/mfa-recoveries/${id}/review`,
        json("POST", input),
      )
    ).data,
}

export const sessionsApi = {
  mine: async () => (await request<AdminSessionList>("/admin/sessions")).data,
  /** A sessão atual não entra aqui: para encerrá-la, use `authApi.logout`. */
  revoke: async (id: string) =>
    (await request<RevokeSessionsResult>(`/admin/sessions/${id}`, json("DELETE")))
      .data,
  revokeOthers: async () =>
    (
      await request<RevokeSessionsResult>(
        "/admin/sessions/revoke-others",
        json("POST"),
      )
    ).data,
}

/**
 * Segurança da própria conta. Separado de `mfaRecoveryApi` de propósito: lá é
 * para quem perdeu o acesso e precisa de e-mail e aprovação; aqui a pessoa está
 * autenticada e reautentica na hora.
 */
export const ownSecurityApi = {
  overview: async () =>
    (await request<AdminSecurityOverview>("/admin/security/overview")).data,
  changePassword: async (input: ChangeOwnPasswordInput) =>
    (
      await request<ChangeOwnPasswordResult>(
        "/admin/security/password",
        json("PATCH", input),
      )
    ).data,
  /** Lote novo invalida o anterior. Os códigos aparecem só nesta resposta. */
  regenerateRecoveryCodes: async (input: ReauthInput) =>
    (
      await request<RegenerateRecoveryCodesResult>(
        "/admin/security/recovery-codes",
        json("POST", input),
      )
    ).data,
  startAuthenticatorReplacement: async (input: ReauthInput) =>
    (
      await request<StartAuthenticatorResult>(
        "/admin/security/authenticator/start",
        json("POST", input),
      )
    ).data,
  confirmAuthenticatorReplacement: async (setupTicket: string, code: string) =>
    (
      await request<ConfirmAuthenticatorResult>(
        "/admin/security/authenticator/confirm",
        json("POST", { setupTicket, code }),
      )
    ).data,
}

/** Trilha de segurança: a rota de auditoria que já existia, com o grupo certo. */
export const securityHistoryApi = {
  list: (filters: SecurityHistoryFilters = {}) =>
    listWithTotal<AuditEntryRow>("/admin/audit-logs", {
      group: "security",
      ...filters,
    }),
}
