import { lazy, Suspense } from "react"
import { AuthProvider, useAuth } from "./auth/AuthContext"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Loading } from "./components/ui"
import { readPublicRoute, type Page, useRoute } from "./hooks/useRoute"
import { AdminLayout } from "./layout/AdminLayout"
import { AccessDeniedPage, UnavailablePage } from "./pages/AccessStatePages"
import LoginPage from "./pages/LoginPage"
import { PreferencesProvider } from "./preferences/PreferencesContext"

// Sob demanda: quem ainda não entrou não baixa o código das telas administrativas.
const pages: Record<Page, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: lazy(() => import("./pages/DashboardPage")),
  users: lazy(() => import("./pages/UsersPage")),
  verifications: lazy(() => import("./pages/VerificationsPage")),
  rides: lazy(() => import("./pages/RidesPage")),
  moderation: lazy(() => import("./pages/ModerationPage")),
  reports: lazy(() => import("./pages/ReportsPage")),
  audit: lazy(() => import("./pages/AuditPage")),
  account: lazy(() => import("./pages/AccountPage")),
  admins: lazy(() => import("./pages/AdminsPage")),
  security: lazy(() => import("./pages/SecurityPage")),
  sessions: lazy(() => import("./pages/SessionsPage")),
  "security-history": lazy(() => import("./pages/SecurityHistoryPage")),
  settings: lazy(() => import("./pages/SettingsPage")),
}

/**
 * Telas abertas por link de e-mail, antes de existir sessão. Também sob demanda:
 * quem está só trabalhando no painel nunca baixa o código do aceite de convite.
 */
const publicPages = {
  invite: lazy(() => import("./pages/InviteAcceptPage")),
  "password-reset": lazy(() => import("./pages/PasswordResetPage")),
  "authenticator-recovery": lazy(() => import("./pages/AuthenticatorRecoveryPage")),
}

function Panel() {
  const { page, search, navigate, updateSearch } = useRoute()
  const Current = pages[page]
  return (
    <AdminLayout
      page={page}
      search={search}
      navigate={navigate}
      updateSearch={updateSearch}
    >
      <ErrorBoundary key={page}>
        <Suspense fallback={<Loading />}>
          <Current />
        </Suspense>
      </ErrorBoundary>
    </AdminLayout>
  )
}

function Gate() {
  const { status } = useAuth()
  if (status === "loading")
    return (
      <div className="auth-screen">
        <Loading label="Verificando sessão..." />
      </div>
    )
  if (status === "anonymous") return <LoginPage />
  if (status === "denied") return <AccessDeniedPage />
  if (status === "unavailable") return <UnavailablePage />
  return <Panel />
}

export default function App() {
  // Rota pública antes da verificação de sessão: quem recebeu um convite ou um
  // link de recuperação não tem sessão nenhuma, e mandá-la para o login
  // esconderia o motivo de ter clicado no link.
  const publicRoute = readPublicRoute(window.location.pathname)
  if (publicRoute) {
    const PublicPage = publicPages[publicRoute]
    return (
      <PreferencesProvider>
        <ErrorBoundary>
          <Suspense fallback={<Loading />}>
            <PublicPage />
          </Suspense>
        </ErrorBoundary>
      </PreferencesProvider>
    )
  }

  return (
    <PreferencesProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </PreferencesProvider>
  )
}
