import { useCallback, useMemo, useSyncExternalStore } from "react"

export type Page =
  | "dashboard"
  | "users"
  | "verifications"
  | "rides"
  | "moderation"
  | "reports"
  | "audit"
  | "account"
  | "admins"
  | "security"
  | "sessions"
  | "security-history"
  | "settings"

const paths: Record<Page, string> = {
  dashboard: "/",
  users: "/usuarios",
  verifications: "/verificacoes",
  rides: "/caronas",
  moderation: "/moderacao",
  reports: "/relatorios",
  audit: "/auditoria",
  account: "/minha-conta",
  admins: "/administradores",
  security: "/seguranca",
  sessions: "/sessoes",
  "security-history": "/historico-de-seguranca",
  settings: "/configuracoes",
}

/**
 * Telas que acontecem antes de existir sessão, abertas por link de e-mail. Não
 * são páginas do painel: ficam fora da área autenticada e não passam pelo menu.
 * O token vem na busca (`?token=`) e nunca no caminho, para não acabar em log
 * de servidor nem em histórico compartilhável do navegador.
 */
export const PUBLIC_ROUTES = {
  "/convite": "invite",
  "/redefinir-senha": "password-reset",
  "/recuperar-autenticador": "authenticator-recovery",
} as const

export type PublicRoute = (typeof PUBLIC_ROUTES)[keyof typeof PUBLIC_ROUTES]

export function readPublicRoute(pathname: string): PublicRoute | undefined {
  return PUBLIC_ROUTES[pathname as keyof typeof PUBLIC_ROUTES]
}

export const pathOf = (page: Page, search?: Record<string, string>) => {
  const query = new URLSearchParams(search).toString()
  return `${paths[page]}${query ? `?${query}` : ""}`
}

const pageByPath = new Map(
  Object.entries(paths).map(([page, path]) => [path, page as Page]),
)
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener("popstate", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("popstate", listener)
  }
}

const readLocation = () => window.location.pathname + window.location.search

export function useRoute() {
  const location = useSyncExternalStore(subscribe, readLocation)
  const url = useMemo(
    () => new URL(location, window.location.origin),
    [location],
  )
  const page = pageByPath.get(url.pathname) ?? "dashboard"

  const navigate = useCallback((next: Page, search?: Record<string, string>) => {
    window.history.pushState(null, "", pathOf(next, search))
    listeners.forEach((listener) => listener())
  }, [])

  // Filtros substituem a entrada do histórico: "voltar" sai da tela, não desfaz cada tecla.
  const updateSearch = useCallback((patch: Record<string, string>) => {
    const current = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(patch)) {
      if (value) current.set(key, value)
      else current.delete(key)
    }
    const query = current.toString()
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    )
    listeners.forEach((listener) => listener())
  }, [])

  return { page, search: url.searchParams, navigate, updateSearch }
}
