import { vi } from "vitest"

export type Reply = {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}
type Handler = Reply | ((call: Call) => Reply)
export type Call = {
  method: string
  path: string
  search: URLSearchParams
  body: unknown
  headers: Headers
}

/** API de mentira por rota, no nível do fetch: o código real de http.ts roda inteiro. */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://panel.test")
    const method = init?.method ?? "GET"
    const path = url.pathname.replace("/api/v1", "")
    const call: Call = {
      method,
      path,
      search: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
    }
    calls.push(call)
    const handler = routes[`${method} ${path}`]
    if (!handler)
      return new Response(JSON.stringify({ code: "HTTP_404", message: "Rota não simulada" }), {
        status: 404,
      })
    const reply = typeof handler === "function" ? handler(call) : handler
    const status = reply.status ?? 200
    return new Response(
      status === 204 ? null : JSON.stringify(reply.body ?? null),
      { status, headers: reply.headers },
    )
  })
  vi.stubGlobal("fetch", fetchMock)
  return {
    calls,
    routes,
    find: (method: string, path: string) =>
      calls.filter((call) => call.method === method && call.path === path),
  }
}

export const adminUser = {
  id: "11111111-1111-4111-8111-111111111111",
  fullName: "Ana Administradora",
  email: "ana@ucb.edu.br",
  roles: ["ADMIN"],
  // A sessão real traz as permissões da conta. A fixture usa todas para as
  // telas existentes seguirem completas nos testes.
  permissions: [
    "MANAGE_ADMINS",
    "MANAGE_USERS",
    "REVIEW_VERIFICATIONS",
    "MODERATE_INCIDENTS",
    "VIEW_REPORTS",
    "VIEW_AUDIT",
  ],
  twoFactorEnabled: true,
  recoveryCodesRemaining: 8,
}

export const emptySummary = {
  users: { total: 0, active: 0, drivers: 0 },
  rides: { open: 0, scheduled: 0, inProgress: 0, completed: 0, cancelled: 0 },
  verifications: { pending: 0, pendingOver24h: 0 },
  incidents: { open: 0, underReview: 0 },
  generatedAt: "2026-11-04T12:00:00.000Z",
}

/** Rotas de um administrador autenticado, com o sistema vazio. */
export function signedInRoutes(): Record<string, Handler> {
  const emptyList = { body: [], headers: { "X-Total-Count": "0" } }
  return {
    "GET /admin/auth/session": { body: adminUser },
    "GET /admin/dashboard/summary": { body: emptySummary },
    "GET /admin/dashboard/series": { body: [] },
    "GET /admin/audit-logs": emptyList,
    "GET /admin/users": emptyList,
    "GET /admin/rides": emptyList,
    "GET /admin/incidents": emptyList,
    "GET /admin/academic-verifications": emptyList,
    "POST /admin/auth/logout": { status: 204 },
  }
}
