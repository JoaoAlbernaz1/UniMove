import { useState } from "react"
import {
  ChevronRight,
  KeyRound,
  Laptop,
  ShieldCheck,
  Smartphone,
} from "lucide-react"
import {
  AlertBanner,
  PasswordChecklist,
  PasswordInput,
  passwordMeetsPolicy,
} from "../components/fields"
import {
  Avatar,
  Badge,
  Button,
  ErrorState,
  Loading,
  Modal,
  PageIntro,
} from "../components/ui"
import { useQuery } from "../hooks/useQuery"
import { useAdmin } from "../layout/AdminContext"
import { formatDateTime, initialsOf } from "../lib/format"
import { describeDevice } from "../lib/userAgent"
import { ownSecurityApi, permissionsApi, securityHistoryApi } from "../services/adminIamApi"
import { iamErrorMessage, unavailable } from "../services/adminIamErrors"
import { auditActionLabel, roleLabel } from "../lib/labels"
import { auditTone } from "../lib/securityLabels"
import type { AdminPermissionInfo } from "../types/admin-iam"
import type { RoleName } from "../types/api"

const NOT_RECORDED = "Sem registro"

export default function AccountPage() {
  const { navigate, showToast } = useAdmin()
  const [passwordOpen, setPasswordOpen] = useState(false)

  const overview = useQuery(() => ownSecurityApi.overview(), [])
  const catalog = useQuery(() => permissionsApi.catalog(), [])
  const history = useQuery(() => securityHistoryApi.list({ page: 1 }), [])

  if (overview.loading) return <Loading label="Carregando sua conta..." />
  if (!overview.data)
    return (
      <ErrorState
        error={overview.error ?? unavailable()}
        onRetry={() => void overview.reload()}
      />
    )

  const { account, twoFactor, password, sessions, lastLoginAt } = overview.data
  const labels = new Map<string, AdminPermissionInfo>(
    (catalog.data ?? []).map((item) => [item.value, item]),
  )

  return (
    <>
      <PageIntro
        title="Minha conta"
        description="Credenciais institucionais, nível de acesso e resumo de proteção da sua conta."
        action={
          <div className="action-group">
            <Button variant="secondary" onClick={() => setPasswordOpen(true)}>
              <KeyRound size={15} aria-hidden="true" /> Alterar senha
            </Button>
            <Button onClick={() => navigate("security")}>
              <ShieldCheck size={15} aria-hidden="true" /> Segurança e 2FA
            </Button>
          </div>
        }
      />

      <div className="account-overview-grid">
        <section className="panel account-card">
          <div className="account-identity">
            <Avatar initials={initialsOf(account.fullName)} size="lg" />
            <div>
              <div className="inline-badges">
                <Badge tone={account.status === "ACTIVE" ? "green" : "red"}>
                  {account.status === "ACTIVE" ? "Ativa" : "Indisponível"}
                </Badge>
                <Badge tone={twoFactor.enabled ? "green" : "amber"}>
                  {twoFactor.enabled ? "MFA ativo" : "MFA pendente"}
                </Badge>
              </div>
              <h2>{account.fullName}</h2>
              <p>{account.email}</p>
            </div>
          </div>
          <div className="account-meta-grid">
            <div>
              <span>Perfis</span>
              <strong>
                {account.roles
                  .map((role) => roleLabel[role as RoleName] ?? role)
                  .join(", ")}
              </strong>
            </div>
            <div>
              <span>Permissões administrativas</span>
              <strong>
                {account.permissions.length
                  ? `${account.permissions.length} de ${labels.size || account.permissions.length}`
                  : "Nenhuma concedida"}
              </strong>
            </div>
            <div>
              <span>Último acesso</span>
              <strong>{lastLoginAt ? formatDateTime(lastLoginAt) : NOT_RECORDED}</strong>
            </div>
            <div>
              <span>Credencial criada em</span>
              <strong>{formatDateTime(account.createdAt)}</strong>
            </div>
          </div>
          {account.permissions.length > 0 && (
            <ul className="scope-list in-card">
              {account.permissions.map((permission) => (
                <li key={permission}>
                  <ShieldCheck size={14} aria-hidden="true" />
                  {labels.get(permission)?.label ?? permission}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel account-card">
          <div className="section-heading">
            <div>
              <h2>Proteção e autenticação</h2>
              <p>Estado atual do segundo fator e sessões conectadas</p>
            </div>
            <Badge tone={twoFactor.enabled ? "green" : "amber"}>
              {twoFactor.enabled ? "MFA ativo" : "MFA pendente"}
            </Badge>
          </div>
          <div className="account-security-list">
            <div className="security-summary-row">
              <span className="attention-icon green">
                <Smartphone size={17} aria-hidden="true" />
              </span>
              <div>
                <strong>Autenticação em duas etapas</strong>
                <small>
                  Aplicativo autenticador • {twoFactor.recoveryCodesRemaining} de{" "}
                  {twoFactor.recoveryCodesTotal} códigos de recuperação disponíveis
                </small>
              </div>
              <Button variant="ghost" onClick={() => navigate("security")}>
                Gerenciar <ChevronRight size={14} aria-hidden="true" />
              </Button>
            </div>
            <div className="security-summary-row">
              <span className="attention-icon blue">
                <Laptop size={17} aria-hidden="true" />
              </span>
              <div>
                <strong>
                  {sessions.active === 1
                    ? "1 sessão ativa em seu nome"
                    : `${sessions.active} sessões ativas em seu nome`}
                </strong>
                <small>
                  {sessions.currentStartedAt
                    ? `Esta sessão começou em ${formatDateTime(sessions.currentStartedAt)}`
                    : "Sessão atual não identificada"}
                  {sessions.currentUserAgent
                    ? ` • ${describeDevice(sessions.currentUserAgent)}`
                    : ""}
                </small>
              </div>
              <Button variant="ghost" onClick={() => navigate("sessions")}>
                Ver sessões <ChevronRight size={14} aria-hidden="true" />
              </Button>
            </div>
            <div className="security-summary-row">
              <span className="attention-icon amber">
                <KeyRound size={17} aria-hidden="true" />
              </span>
              <div>
                <strong>Senha administrativa</strong>
                <small>
                  {password.changedAt
                    ? `Última alteração em ${formatDateTime(password.changedAt)}`
                    : "Nenhuma alteração registrada nesta conta"}
                </small>
              </div>
              <Button variant="ghost" onClick={() => setPasswordOpen(true)}>
                Alterar senha <ChevronRight size={14} aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Atividades de segurança recentes</h2>
            <p>Eventos registrados na trilha de auditoria</p>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => navigate("security-history")}
          >
            Ver histórico completo <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
        {history.loading ? (
          <Loading label="Carregando eventos..." />
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={() => void history.reload()} />
        ) : (
          <div className="mini-timeline in-card">
            {history.data?.items.slice(0, 5).map((entry) => (
              <div key={entry.id}>
                {/* A cor acompanha o desfecho: falha em verde leria como sucesso. */}
                <i aria-hidden="true" data-tone={auditTone(entry.action)} />
                <span>
                  {auditActionLabel(entry.action)}
                  {entry.actor ? ` • ${entry.actor.fullName}` : ""}
                </span>
                <small>{formatDateTime(entry.createdAt)}</small>
              </div>
            ))}
            {!history.data?.items.length && (
              <p className="subtle">Nenhum evento de segurança registrado ainda.</p>
            )}
          </div>
        )}
      </section>

      {passwordOpen && (
        <ChangePasswordModal
          onClose={() => setPasswordOpen(false)}
          onDone={(revoked) => {
            setPasswordOpen(false)
            void overview.reload()
            showToast({
              message:
                revoked > 0
                  ? `Senha alterada. ${revoked === 1 ? "1 outra sessão foi encerrada" : `${revoked} outras sessões foram encerradas`}.`
                  : "Senha alterada com sucesso.",
            })
          }}
        />
      )}
    </>
  )
}

/**
 * Troca de senha de quem está autenticado. Pede a senha atual, não um link por
 * e-mail: aquele caminho é o de quem perdeu o acesso.
 */
export function ChangePasswordModal({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (sessionsRevoked: number) => void
}) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const ready =
    current.length > 0 && passwordMeetsPolicy(next) && next === confirmation && !busy

  async function submit() {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await ownSecurityApi.changePassword({
        currentPassword: current,
        password: next,
      })
      onDone(result.sessionsRevoked)
    } catch (reason) {
      setError(iamErrorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Alterar senha administrativa"
      description="Suas outras sessões serão encerradas. Esta permanece aberta."
      onClose={onClose}
      dismissible={!busy}
    >
      <div className="modal-body auth-form">
        <AlertBanner tone="info">
          A autenticação em duas etapas continua obrigatória depois da troca.
        </AlertBanner>
        <PasswordInput
          label="Senha atual"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          name="senha-atual"
        />
        <PasswordInput
          label="Nova senha"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          name="senha-nova"
        />
        <PasswordInput
          label="Confirmar nova senha"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          name="senha-confirmacao"
          error={
            confirmation.length > 0 && confirmation !== next
              ? "A confirmação precisa ser idêntica à nova senha."
              : undefined
          }
        />
        <PasswordChecklist password={next} confirmation={confirmation} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={() => void submit()} disabled={!ready} aria-busy={busy}>
          {busy ? "Salvando..." : "Salvar nova senha"}
        </Button>
      </footer>
    </Modal>
  )
}
