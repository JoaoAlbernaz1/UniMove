import { API_BASE_PATH } from "../config"

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/** A API respondeu, mas este ambiente ainda não tem as rotas administrativas publicadas. */
export const ADMIN_API_MISSING = "ADMIN_API_MISSING"

const UNAVAILABLE_MESSAGE =
  "O servidor está iniciando ou indisponível. Tente de novo em instantes."
const MISSING_MESSAGE =
  "A API deste ambiente ainda não tem as rotas do painel. Os dados não foram alterados. Tente novamente depois da publicação do backend administrativo."
const INVALID_RESPONSE_MESSAGE =
  "O servidor respondeu em um formato inesperado. Tente novamente em instantes."

/**
 * Códigos que acompanham um 401 e **não** significam sessão expirada: são
 * credencial errada dentro de uma sessão que continua válida — a senha ou o
 * código do autenticador pedidos de novo numa operação sensível.
 *
 * Sem esta distinção, errar o código de seis dígitos faria o cliente tentar
 * renovar a sessão, falhar de novo e concluir que ela acabou, derrubando para o
 * login quem só digitou um número errado.
 */
const STEP_UP_CODES = new Set([
  "ADMIN_REAUTH_FAILED",
  "ADMIN_REAUTH_CODE_ALREADY_USED",
  "INVALID_CREDENTIALS",
  "INVALID_CODE",
  "ADMIN_FACTOR_SETUP_EXPIRED",
  "ADMIN_TOKEN_INVALID",
  "ADMIN_INVITE_INVALID",
])

type SessionListeners = {
  onExpired?: () => void
  onForbidden?: (error: ApiError) => void
}

type RefreshOutcome = "renewed" | "denied" | "unavailable"

let listeners: SessionListeners = {}
let refreshing: Promise<RefreshOutcome> | null = null

export function setSessionListeners(next: SessionListeners) {
  listeners = next
}

function readCsrfToken() {
  const match = document.cookie.match(
    /(?:^|;\s*)(?:__Host-)?uc_admin_csrf=([^;]+)/,
  )
  return match ? decodeURIComponent(match[1]) : undefined
}

async function send(path: string, init: RequestInit = {}) {
  const method = (init.method ?? "GET").toUpperCase()
  const headers = new Headers(init.headers)
  headers.set("Accept", headers.get("Accept") ?? "application/json")
  if (init.body) headers.set("Content-Type", "application/json")
  if (!["GET", "HEAD"].includes(method)) {
    const csrf = readCsrfToken()
    if (csrf) headers.set("x-csrf-token", csrf)
  }
  try {
    return await fetch(`${API_BASE_PATH}${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
    })
  } catch {
    throw new ApiError(
      "Não foi possível falar com o servidor. Verifique sua conexão.",
      0,
      "NETWORK_ERROR",
    )
  }
}

async function toError(response: Response) {
  const body = (await response.json().catch(() => undefined)) as
    | Record<string, unknown>
    | undefined
  if ([502, 503, 504].includes(response.status) && !body?.code)
    return new ApiError(
      UNAVAILABLE_MESSAGE,
      response.status,
      "SERVICE_UNAVAILABLE",
    )
  const message = body?.message
  // Rota inexistente: o Nest responde "Cannot GET /caminho", e um proxy responde sem JSON.
  // "Usuário não encontrado" e afins têm mensagem própria e seguem o caminho normal.
  if (
    response.status === 404 &&
    (!body || (typeof message === "string" && /^Cannot [A-Z]+ /.test(message)))
  )
    return new ApiError(MISSING_MESSAGE, 404, ADMIN_API_MISSING)
  const text = Array.isArray(message)
    ? message.join(" ")
    : typeof message === "string"
      ? message
      : "Não foi possível concluir a operação."
  return new ApiError(
    text,
    response.status,
    typeof body?.code === "string" ? body.code : undefined,
    body,
  )
}

async function readJson<T>(response: Response) {
  if (response.status === 204) return undefined as T
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(
      INVALID_RESPONSE_MESSAGE,
      response.status,
      "INVALID_RESPONSE",
    )
  }
}

/** Um único refresh por vez: várias telas recebendo 401 juntas não giram o token várias vezes. */
function refreshSession() {
  refreshing ??= send("/admin/auth/refresh", { method: "POST" })
    .then((response): RefreshOutcome => {
      if (response.ok) return "renewed"
      return response.status >= 400 && response.status < 404
        ? "denied"
        : "unavailable"
    })
    .catch((): RefreshOutcome => "unavailable")
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

async function authorized(path: string, init?: RequestInit) {
  let response = await send(path, init)
  if (response.status === 401) {
    // Credencial errada na própria requisição não é sessão perdida: devolve o
    // erro sem renovar nada e sem avisar que a sessão caiu.
    const first = await toError(response)
    if (first.code && STEP_UP_CODES.has(first.code)) throw first
    const outcome = await refreshSession()
    // Mesmo se falhou, tenta de novo: em disputa entre abas, a outra já gravou cookies novos.
    response = await send(path, init)
    if (response.status === 401) {
      // Servidor instável não é sessão encerrada: quem está trabalhando não perde o que digitou.
      if (outcome === "unavailable")
        throw new ApiError(UNAVAILABLE_MESSAGE, 503, "SERVICE_UNAVAILABLE")
      const error = await toError(response)
      listeners.onExpired?.()
      throw error
    }
  }
  if (!response.ok) {
    const error = await toError(response)
    // Acesso perdido no meio da sessão. CSRF e origem têm código próprio e não entram aqui.
    if (
      response.status === 403 &&
      (error.code === "HTTP_403" || error.code === "ADMIN_2FA_REQUIRED")
    )
      listeners.onForbidden?.(error)
    throw error
  }
  return response
}

export async function request<T>(path: string, init?: RequestInit) {
  const response = await authorized(path, init)
  return { data: await readJson<T>(response), headers: response.headers }
}

export async function requestBlob(path: string) {
  const response = await authorized(path, {
    headers: { Accept: "text/csv" },
  })
  return { blob: await response.blob(), headers: response.headers }
}

/** Fluxo de login: 401 aqui significa credencial errada, não sessão expirada. */
export async function requestPublic<T>(path: string, init?: RequestInit) {
  const response = await send(path, init)
  if (!response.ok) throw await toError(response)
  return readJson<T>(response)
}
