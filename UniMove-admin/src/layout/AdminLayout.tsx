import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  BarChart3,
  Bell,
  Car,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  Flag,
  History,
  KeyRound,
  Laptop,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  UserCog,
  Users,
  X,
} from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { Avatar, BrandIdentity, Toast, cn } from "../components/ui"
import { useDismiss } from "../hooks/useDismiss"
import { useQuery } from "../hooks/useQuery"
import { type Page, pathOf } from "../hooks/useRoute"
import { countOf, initialsOf } from "../lib/format"
import { dashboardApi } from "../services/adminApi"
import { usePreferences } from "../preferences/PreferencesContext"
import { AdminContext, type ToastInput } from "./AdminContext"

const pageTitles: Record<Page, string> = {
  dashboard: "Visão geral",
  users: "Usuários",
  verifications: "Verificações",
  rides: "Caronas",
  moderation: "Moderação",
  reports: "Relatórios",
  audit: "Auditoria",
  account: "Minha conta",
  admins: "Administradores",
  security: "Segurança da conta",
  sessions: "Sessões ativas",
  "security-history": "Histórico de segurança",
  settings: "Configurações",
}

/** Link de verdade: abre em nova aba e mostra o destino, sem recarregar no clique normal. */
function PageLink({
  page,
  navigate,
  className,
  current,
  children,
}: {
  page: Page
  navigate: (page: Page) => void
  className?: string
  current?: boolean
  children: ReactNode
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(page)
  }
  return (
    <a
      href={pathOf(page)}
      className={className}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </a>
  )
}

const compactCount = (value: number) => (value > 99 ? "99+" : String(value))

export function AdminLayout({
  page,
  search,
  navigate: goTo,
  updateSearch,
  children,
}: {
  page: Page
  search: URLSearchParams
  navigate: (page: Page, search?: Record<string, string>) => void
  updateSearch: (patch: Record<string, string>) => void
  children: ReactNode
}) {
  const { user, logout, can } = useAuth()
  const { preferences, updatePreferences } = usePreferences()
  const { sidebarCollapsed } = preferences
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileMenu, setProfileMenu] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [toast, setToast] = useState<ToastInput | null>(null)
  const toastTimer = useRef<number>(undefined)
  const mainRef = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const searchField = useRef<HTMLInputElement>(null)
  const notificationsWrap = useRef<HTMLDivElement>(null)
  const profileWrap = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef(false)
  const summaryQuery = useQuery(() => dashboardApi.summary(), [])
  const summary = summaryQuery.data
  const refreshSummary = summaryQuery.reload

  const pendingVerifications = summary?.verifications.pending ?? 0
  const openIncidents = summary
    ? summary.incidents.open + summary.incidents.underReview
    : 0
  const alerts = pendingVerifications + openIncidents

  const navigation = [
    { id: "dashboard" as Page, icon: LayoutDashboard },
    { id: "users" as Page, icon: Users },
    {
      id: "verifications" as Page,
      icon: ClipboardCheck,
      count: pendingVerifications,
      countLabel: "pendentes",
    },
    { id: "rides" as Page, icon: Car },
    {
      id: "moderation" as Page,
      icon: ShieldCheck,
      count: openIncidents,
      countLabel: "em aberto",
    },
    { id: "reports" as Page, icon: BarChart3 },
    { id: "audit" as Page, icon: History },
  ]

  /**
   * Segunda seção do menu, como no desenho do Figma. "Administradores" só
   * aparece para quem tem MANAGE_ADMINS: a rota recusa de todo modo, e oferecer
   * um link que devolve 403 não ajuda ninguém.
   */
  const securityNavigation = [
    { id: "account" as Page, icon: UserCog },
    ...(can("MANAGE_ADMINS") ? [{ id: "admins" as Page, icon: Users }] : []),
    { id: "security" as Page, icon: Smartphone },
    { id: "sessions" as Page, icon: Laptop },
    { id: "security-history" as Page, icon: KeyRound },
  ]

  const navigate = useCallback(
    (next: Page, nextSearch?: Record<string, string>) => {
      pendingFocus.current = next !== page
      goTo(next, nextSearch)
      setSidebarOpen(false)
      setNotifications(false)
      setProfileMenu(false)
    },
    [goTo, page],
  )

  // Troca de tela em SPA: sem isto o leitor de tela não percebe a mudança e a rolagem fica no meio.
  useEffect(() => {
    document.title = `${pageTitles[page]} - UniCarona Admin`
    if (!pendingFocus.current) return
    pendingFocus.current = false
    window.scrollTo(0, 0)
    mainRef.current?.focus({ preventScroll: true })
  }, [page])

  // Quem volta para a aba vê pendências atuais, sem consulta periódica ao servidor.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSummary()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [refreshSummary])

  const closeNotifications = useCallback(() => setNotifications(false), [])
  const closeProfile = useCallback(() => setProfileMenu(false), [])
  useDismiss(notificationsWrap, notifications, closeNotifications)
  useDismiss(profileWrap, profileMenu, closeProfile)

  // Gaveta do celular: o conteúdo atrás fica inerte e o foco entra e volta com ela.
  useEffect(() => {
    if (!sidebarOpen) return
    const button = menuButton.current
    sidebar.current?.querySelector<HTMLElement>("a")?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false)
    }
    const onResize = () => {
      if (window.innerWidth > 900) setSidebarOpen(false)
    }
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", onResize)
    return () => {
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onResize)
      button?.focus()
    }
  }, [sidebarOpen])

  // "/" leva à busca, como em outros painéis, exceto enquanto se digita em um campo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
      )
        return
      const field = searchField.current
      // No celular a busca do topo fica oculta, e com um diálogo aberto o fundo está inerte.
      if (
        !field?.form ||
        getComputedStyle(field.form).display === "none" ||
        field.closest("[inert]")
      )
        return
      event.preventDefault()
      field.focus()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // Erro fica até ser fechado: costuma pedir uma providência, e 6 segundos não bastam para ler.
  const showToast = useCallback((next: ToastInput) => {
    setToast(next)
    window.clearTimeout(toastTimer.current)
    if (next.type !== "error")
      toastTimer.current = window.setTimeout(() => setToast(null), 6000)
  }, [])

  const context = useMemo(
    () => ({
      showToast,
      navigate,
      search,
      updateSearch,
      summary,
      summaryError: summaryQuery.error,
      refreshSummary,
    }),
    [
      showToast,
      navigate,
      search,
      updateSearch,
      summary,
      summaryQuery.error,
      refreshSummary,
    ],
  )
  const initials = initialsOf(user?.fullName ?? "")

  return (
    <AdminContext.Provider value={context}>
      <div
        className={cn("app-shell", sidebarCollapsed && "sidebar-collapsed")}
        data-text-size={preferences.textSize}
        data-density={preferences.compactTables ? "compact" : "comfortable"}
      >
        <a className="skip-link" href="#main-content">
          Ir para o conteúdo
        </a>
        {sidebarOpen && (
          <button
            type="button"
            className="mobile-overlay"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fechar menu"
            tabIndex={-1}
          />
        )}
        <aside ref={sidebar} className={cn("sidebar", sidebarOpen && "open")}>
          <div className="brand">
            <BrandIdentity />
            <button
              type="button"
              className="icon-button mobile-close"
              onClick={() => setSidebarOpen(false)}
              aria-label="Fechar menu"
            >
              <X size={18} />
            </button>
          </div>
          <nav className="nav-list nav-list-primary" aria-label="Principal">
            {navigation.map(({ id, icon: Icon, count, countLabel }) => (
              <PageLink
                key={id}
                page={id}
                navigate={navigate}
                className="nav-item"
                current={page === id}
              >
                <Icon size={17} aria-hidden="true" />
                <span className="nav-label">{pageTitles[id]}</span>
                {count ? (
                  <>
                    <span className="nav-count" aria-hidden="true">
                      {compactCount(count)}
                    </span>
                    <span className="sr-only">
                      , {count} {countLabel}
                    </span>
                  </>
                ) : null}
              </PageLink>
            ))}
          </nav>
          <nav className="nav-list nav-list-security" aria-label="Configurações e segurança">
            <div className="nav-section-label">SEGURANÇA E ACESSO</div>
            {securityNavigation.map(({ id, icon: Icon }) => (
              <PageLink
                key={id}
                page={id}
                navigate={navigate}
                className="nav-item"
                current={page === id}
              >
                <Icon size={17} aria-hidden="true" />
                <span className="nav-label">{pageTitles[id]}</span>
              </PageLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <PageLink
              page="settings"
              navigate={navigate}
              className="nav-item"
              current={page === "settings"}
            >
              <Settings size={17} aria-hidden="true" />
              <span className="nav-label">{pageTitles.settings}</span>
            </PageLink>
          </div>
        </aside>
        <div className="main-column" inert={sidebarOpen}>
          <header className="topbar">
            <div className="topbar-left">
              <button
                ref={menuButton}
                type="button"
                className="icon-button menu-button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Abrir menu"
              >
                <Menu size={18} />
              </button>
              <button
                type="button"
                className="icon-button collapse-button"
                onClick={() =>
                  updatePreferences({ sidebarCollapsed: !sidebarCollapsed })
                }
                aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
                aria-expanded={!sidebarCollapsed}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen size={17} />
                ) : (
                  <PanelLeftClose size={17} />
                )}
              </button>
              <nav className="breadcrumb" aria-label="Trilha de navegação">
                <ol>
                  {page !== "dashboard" && (
                    <li>
                      <PageLink page="dashboard" navigate={navigate}>
                        {pageTitles.dashboard}
                      </PageLink>
                      <ChevronRight size={14} aria-hidden="true" />
                    </li>
                  )}
                  <li>
                    <span aria-current="page">{pageTitles[page]}</span>
                  </li>
                </ol>
              </nav>
            </div>
            <div className="topbar-actions">
              <form
                className="global-search"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault()
                  const q = String(
                    new FormData(event.currentTarget).get("q") ?? "",
                  ).trim()
                  navigate("users", q ? { q } : undefined)
                }}
              >
                <Search size={15} aria-hidden="true" />
                <input
                  ref={searchField}
                  name="q"
                  type="search"
                  placeholder="Buscar usuários"
                  aria-label="Buscar usuários"
                  aria-keyshortcuts="/"
                />
                <kbd aria-hidden="true">/</kbd>
              </form>
              <div className="popover-wrap" ref={notificationsWrap}>
                <button
                  type="button"
                  className="icon-button notification-button"
                  onClick={() => setNotifications(!notifications)}
                  aria-label={alerts ? `Pendências: ${alerts}` : "Pendências"}
                  aria-expanded={notifications}
                >
                  <Bell size={17} />
                  {alerts > 0 && (
                    <span aria-hidden="true">{compactCount(alerts)}</span>
                  )}
                </button>
                {notifications && (
                  <div className="popover notification-popover">
                    <div className="popover-header">Pendências</div>
                    {summaryQuery.error && (
                      <p className="popover-note" role="alert">
                        Não foi possível atualizar as pendências.
                      </p>
                    )}
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => navigate("verifications")}
                    >
                      <FileCheck2 size={16} aria-hidden="true" />
                      <span>
                        <strong>
                          {countOf(
                            pendingVerifications,
                            "verificação pendente",
                            "verificações pendentes",
                          )}
                        </strong>
                        <small>Aguardando revisão</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => navigate("moderation")}
                    >
                      <Flag size={16} aria-hidden="true" />
                      <span>
                        <strong>
                          {countOf(
                            openIncidents,
                            "denúncia em aberto",
                            "denúncias em aberto",
                          )}
                        </strong>
                        <small>Abertas ou em análise</small>
                      </span>
                    </button>
                  </div>
                )}
              </div>
              <div className="popover-wrap" ref={profileWrap}>
                <button
                  type="button"
                  className="profile-button"
                  onClick={() => setProfileMenu(!profileMenu)}
                  aria-label="Menu da conta"
                  aria-expanded={profileMenu}
                >
                  <Avatar initials={initials} />
                  <strong>{user?.fullName}</strong>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {profileMenu && (
                  <div className="popover profile-popover">
                    <div className="popover-identity">
                      <strong>{user?.fullName}</strong>
                      <span>{user?.email}</span>
                    </div>
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => navigate("settings")}
                    >
                      <Settings size={15} aria-hidden="true" /> Minha conta
                    </button>
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => void logout()}
                    >
                      <LockKeyhole size={15} aria-hidden="true" /> Sair do painel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>
          <main
            ref={mainRef}
            id="main-content"
            className="page-content"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
        {createPortal(
          <div className="toast-region" data-modal-exempt="" aria-live="polite">
            {toast && (
              <Toast
                message={toast.message}
                type={toast.type}
                onClose={() => {
                  window.clearTimeout(toastTimer.current)
                  setToast(null)
                }}
              />
            )}
          </div>,
          document.body,
        )}
      </div>
    </AdminContext.Provider>
  )
}
