import { LockKeyhole, RefreshCw, ShieldAlert } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { BrandIdentity, Button } from "../components/ui"

export function AccessDeniedPage() {
  const { notice, logout } = useAuth()
  return (
    <StateCard
      icon={<ShieldAlert size={18} />}
      title="Acesso não autorizado"
      message={
        notice ?? "Esta conta não tem permissão para usar o painel administrativo."
      }
      action={
        <Button variant="secondary" onClick={() => void logout()}>
          <LockKeyhole size={15} aria-hidden="true" /> Sair e usar outra conta
        </Button>
      }
    />
  )
}

export function UnavailablePage() {
  const { notice, apiMissing, checkSession } = useAuth()
  return (
    <StateCard
      icon={<ShieldAlert size={18} />}
      title={
        apiMissing ? "API do painel ainda não publicada" : "Servidor indisponível"
      }
      message={notice ?? "Não foi possível falar com a API."}
      action={
        <Button variant="secondary" onClick={() => void checkSession()}>
          <RefreshCw size={15} aria-hidden="true" /> Tentar novamente
        </Button>
      }
    />
  )
}

function StateCard({
  icon,
  title,
  message,
  action,
}: {
  icon: React.ReactNode
  title: string
  message: string
  action: React.ReactNode
}) {
  return (
    <div className="auth-screen">
      <div className="brand auth-brand">
        <BrandIdentity />
      </div>
      <section className="auth-card" role="alert">
        <div className="state-icon state-icon-error">{icon}</div>
        <h1>{title}</h1>
        <p className="auth-lead">{message}</p>
        {action}
      </section>
    </div>
  )
}
