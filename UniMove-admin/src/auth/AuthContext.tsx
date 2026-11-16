import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { authApi } from "../services/adminApi"
import { ADMIN_API_MISSING, ApiError, setSessionListeners } from "../services/http"
import type { AdminPermission } from "../types/admin-iam"
import type { SessionUser } from "../types/api"

type AuthStatus =
  | "loading"
  | "anonymous"
  | "authenticated"
  | "denied"
  | "unavailable"

type AuthValue = {
  status: AuthStatus
  user?: SessionUser
  /** Motivo mostrado na tela de login ou de acesso negado. */
  notice?: string
  /** A API respondeu, mas sem as rotas do painel neste ambiente. */
  apiMissing: boolean
  checkSession: () => Promise<void>
  completeLogin: (user: SessionUser) => void
  logout: () => Promise<void>
  /**
   * A conta tem todas as permissões informadas. Serve para esconder o que ela
   * não pode fazer, nunca como autorização: o servidor confere de novo em cada
   * requisição, e permissão revogada vale na hora, sem esperar o token expirar.
   */
  can: (...permissions: AdminPermission[]) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

const EXPIRED_NOTICE = "Sua sessão expirou. Entre novamente para continuar."

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [user, setUser] = useState<SessionUser>()
  const [notice, setNotice] = useState<string>()
  const [apiMissing, setApiMissing] = useState(false)
  const hadSession = useRef(false)

  // Nada de sessão no navegador: quem responde quem é o usuário é sempre a API.
  const checkSession = useCallback(async () => {
    setStatus("loading")
    setNotice(undefined)
    setApiMissing(false)
    try {
      setUser(await authApi.session())
      hadSession.current = true
      setStatus("authenticated")
    } catch (reason) {
      setUser(undefined)
      if (reason instanceof ApiError && reason.status === 401) {
        setStatus("anonymous")
      } else if (reason instanceof ApiError && reason.status === 403) {
        setStatus("denied")
        setNotice(reason.message)
      } else {
        setStatus("unavailable")
        setApiMissing(
          reason instanceof ApiError && reason.code === ADMIN_API_MISSING,
        )
        setNotice(
          reason instanceof ApiError
            ? reason.message
            : "Servidor indisponível no momento.",
        )
      }
    }
  }, [])

  useEffect(() => {
    setSessionListeners({
      onExpired: () => {
        // Vários pedidos podem expirar juntos: só o primeiro decide o aviso.
        if (hadSession.current) setNotice(EXPIRED_NOTICE)
        hadSession.current = false
        setUser(undefined)
        setStatus("anonymous")
      },
      onForbidden: (error) => {
        hadSession.current = false
        setUser(undefined)
        setStatus("denied")
        setNotice(error.message)
      },
    })
    void checkSession()
    return () => setSessionListeners({})
  }, [checkSession])

  const completeLogin = useCallback((next: SessionUser) => {
    hadSession.current = true
    setUser(next)
    setNotice(undefined)
    setStatus("authenticated")
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
      setNotice(undefined)
    } catch {
      setNotice(
        "Não foi possível confirmar a saída no servidor. Feche o navegador se estiver em um computador compartilhado.",
      )
    }
    hadSession.current = false
    setUser(undefined)
    setStatus("anonymous")
  }, [])

  const can = useCallback(
    (...permissions: AdminPermission[]) => {
      const granted = user?.permissions ?? []
      return permissions.every((permission) => granted.includes(permission))
    },
    [user],
  )

  const value = useMemo(
    () => ({
      status,
      user,
      notice,
      apiMissing,
      checkSession,
      completeLogin,
      logout,
      can,
    }),
    [status, user, notice, apiMissing, checkSession, completeLogin, logout, can],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth precisa estar dentro de AuthProvider")
  return value
}
