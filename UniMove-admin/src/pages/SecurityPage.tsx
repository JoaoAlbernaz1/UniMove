import { useState } from "react"
import { Copy, KeyRound, LogOut, RefreshCw, ShieldCheck } from "lucide-react"
import {
  AlertBanner,
  OtpInput,
  StepProgress,
} from "../components/fields"
import { EMPTY_REAUTH, ReauthFields, reauthReady } from "../components/Reauth"
import { RecoveryCodes } from "../components/RecoveryCodes"
import {
  Badge,
  Button,
  ConfirmModal,
  ErrorState,
  Loading,
  Modal,
  PageIntro,
} from "../components/ui"
import { useQuery } from "../hooks/useQuery"
import { useAdmin } from "../layout/AdminContext"
import { formatDateTime } from "../lib/format"
import { describeDevice } from "../lib/userAgent"
import { ownSecurityApi, sessionsApi } from "../services/adminIamApi"
import { asDisplayError, iamErrorMessage, unavailable } from "../services/adminIamErrors"
import type { ReauthInput, StartAuthenticatorResult } from "../types/admin-iam"
import { ChangePasswordModal } from "./AccountPage"

type Dialog =
  | { kind: "none" }
  | { kind: "password" }
  | { kind: "regenerate" }
  | { kind: "revoke-others" }
  | { kind: "replace-start" }
  | { kind: "replace-confirm"; setup: StartAuthenticatorResult }
  | { kind: "codes"; codes: string[]; title: string }

const NOT_RECORDED = "Sem registro"

export default function SecurityPage() {
  const { showToast } = useAdmin()
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" })
  const overview = useQuery(() => ownSecurityApi.overview(), [])

  if (overview.loading) return <Loading label="Carregando segurança da conta..." />
  if (!overview.data)
    return (
      <ErrorState
        error={overview.error ?? unavailable()}
        onRetry={() => void overview.reload()}
      />
    )

  const { twoFactor, password, sessions, lastLoginAt, sessionMaxHours } = overview.data
  const refresh = () => void overview.reload()

  return (
    <>
      <PageIntro
        title="Segurança da conta"
        description="Autenticação em duas etapas, códigos de recuperação, senha e dispositivos conectados."
        action={
          <Badge tone={twoFactor.enabled ? "green" : "amber"}>
            {twoFactor.enabled ? "MFA ativo • Conta protegida" : "MFA pendente"}
          </Badge>
        }
      />

      {!twoFactor.enabled && (
        <AlertBanner tone="warning" title="Segundo fator não está ativo">
          Sem o segundo fator confirmado o painel não abre. Conclua a ativação
          pelo link do convite ou procure outro administrador autorizado.
        </AlertBanner>
      )}

      <div className="account-overview-grid">
        <section className="panel account-card">
          <div className="section-heading">
            <div>
              <h2>Autenticação em duas etapas</h2>
              <p>Obrigatória para toda conta administrativa do UniCarona</p>
            </div>
            <Badge tone={twoFactor.enabled ? "green" : "amber"}>
              {twoFactor.enabled ? "Ativa" : "Pendente"}
            </Badge>
          </div>
          <div className="account-meta-grid">
            <div>
              <span>Método</span>
              <strong>Aplicativo autenticador (TOTP)</strong>
            </div>
            <div>
              <span>Emissor no aplicativo</span>
              <strong>{twoFactor.issuer}</strong>
            </div>
            <div>
              <span>Vinculado em</span>
              <strong>{twoFactor.boundAt ? formatDateTime(twoFactor.boundAt) : NOT_RECORDED}</strong>
            </div>
            <div>
              <span>Códigos de recuperação</span>
              <strong>
                {twoFactor.recoveryCodesRemaining} de {twoFactor.recoveryCodesTotal} disponíveis
              </strong>
            </div>
          </div>
          {twoFactor.recoveryCodesRemaining === 0 && twoFactor.enabled && (
            <div className="account-meta-grid">
              <AlertBanner tone="warning">
                Você não tem códigos de recuperação. Gere um lote novo agora: sem
                eles, perder o autenticador exige aprovação de outro administrador.
              </AlertBanner>
            </div>
          )}
          <div className="card-divider-actions">
            <Button
              variant="secondary"
              disabled={!twoFactor.enabled}
              onClick={() => setDialog({ kind: "regenerate" })}
            >
              <KeyRound size={15} aria-hidden="true" /> Gerar novos códigos
            </Button>
            <Button
              variant="secondary"
              disabled={!twoFactor.enabled}
              onClick={() => setDialog({ kind: "replace-start" })}
            >
              <RefreshCw size={15} aria-hidden="true" /> Substituir autenticador
            </Button>
          </div>
        </section>

        <section className="panel account-card">
          <div className="section-heading">
            <div>
              <h2>Credencial e dispositivos</h2>
              <p>Histórico da senha e controle rápido de sessões</p>
            </div>
          </div>
          <div className="account-meta-grid">
            <div>
              <span>Última alteração de senha</span>
              <strong>
                {password.changedAt ? formatDateTime(password.changedAt) : NOT_RECORDED}
              </strong>
            </div>
            <div>
              <span>Último acesso registrado</span>
              <strong>{lastLoginAt ? formatDateTime(lastLoginAt) : NOT_RECORDED}</strong>
            </div>
            <div>
              <span>Outras sessões abertas</span>
              <strong>
                {sessions.others === 0
                  ? "Nenhuma além desta"
                  : sessions.others === 1
                    ? "1 sessão adicional"
                    : `${sessions.others} sessões adicionais`}
              </strong>
            </div>
            <div>
              <span>Este dispositivo</span>
              <strong>
                {sessions.currentUserAgent
                  ? describeDevice(sessions.currentUserAgent)
                  : "Não identificado"}
              </strong>
            </div>
          </div>
          <div className="account-meta-grid">
            <AlertBanner tone="info">
              A sessão administrativa expira {sessionMaxHours} horas depois do
              login, e renovar não estende esse limite: depois disso é preciso
              entrar de novo com senha e segundo fator.
            </AlertBanner>
          </div>
          <div className="card-divider-actions">
            <Button variant="secondary" onClick={() => setDialog({ kind: "password" })}>
              <KeyRound size={15} aria-hidden="true" /> Trocar senha
            </Button>
            <Button
              variant="danger"
              disabled={sessions.others === 0}
              onClick={() => setDialog({ kind: "revoke-others" })}
            >
              <LogOut size={15} aria-hidden="true" /> Encerrar outras sessões
            </Button>
          </div>
        </section>
      </div>

      {dialog.kind === "password" && (
        <ChangePasswordModal
          onClose={() => setDialog({ kind: "none" })}
          onDone={(revoked) => {
            setDialog({ kind: "none" })
            refresh()
            showToast({
              message:
                revoked > 0
                  ? `Senha alterada e ${revoked === 1 ? "1 outra sessão encerrada" : `${revoked} outras sessões encerradas`}.`
                  : "Senha alterada com sucesso.",
            })
          }}
        />
      )}

      {dialog.kind === "revoke-others" && (
        <ConfirmModal
          title="Encerrar outras sessões"
          description="Os outros dispositivos conectados a esta conta serão desconectados. Esta sessão continua aberta."
          confirmLabel="Encerrar outras sessões"
          destructive
          onClose={() => setDialog({ kind: "none" })}
          onConfirm={async () => {
            try {
              const result = await sessionsApi.revokeOthers()
              setDialog({ kind: "none" })
              refresh()
              showToast({
                message:
                  result.revoked === 1
                    ? "1 sessão encerrada."
                    : `${result.revoked} sessões encerradas.`,
              })
            } catch (reason) {
              throw asDisplayError(reason)
            }
          }}
        />
      )}

      {dialog.kind === "regenerate" && (
        <RegenerateCodesModal
          onClose={() => setDialog({ kind: "none" })}
          onDone={(codes) => {
            refresh()
            setDialog({ kind: "codes", codes, title: "Novos códigos de recuperação" })
          }}
        />
      )}

      {dialog.kind === "replace-start" && (
        <ReplaceAuthenticatorStartModal
          onClose={() => setDialog({ kind: "none" })}
          onStarted={(setup) => setDialog({ kind: "replace-confirm", setup })}
        />
      )}

      {dialog.kind === "replace-confirm" && (
        <ReplaceAuthenticatorConfirmModal
          setup={dialog.setup}
          onClose={() => setDialog({ kind: "none" })}
          onDone={(codes) => {
            refresh()
            setDialog({
              kind: "codes",
              codes,
              title: "Autenticador substituído",
            })
            showToast({ message: "Autenticador substituído com sucesso." })
          }}
        />
      )}

      {dialog.kind === "codes" && (
        <Modal
          title={dialog.title}
          description="Guarde os códigos agora: eles não serão exibidos novamente."
          onClose={() => setDialog({ kind: "none" })}
          width="lg"
          dismissible={false}
        >
          <div className="modal-body auth-form">
            <RecoveryCodes
              codes={dialog.codes}
              continueLabel="Já guardei os códigos"
              onContinue={() => setDialog({ kind: "none" })}
            />
          </div>
        </Modal>
      )}
    </>
  )
}

function RegenerateCodesModal({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (codes: string[]) => void
}) {
  const [reauth, setReauth] = useState<ReauthInput>(EMPTY_REAUTH)
  return (
    <ConfirmModal
      title="Gerar novos códigos de recuperação"
      description="O lote atual deixa de valer imediatamente. Os códigos novos aparecem uma única vez."
      confirmLabel="Gerar novo lote"
      confirmDisabled={!reauthReady(reauth)}
      onClose={onClose}
      onConfirm={async () => {
        try {
          const result = await ownSecurityApi.regenerateRecoveryCodes(reauth)
          onDone(result.recoveryCodes)
        } catch (reason) {
          throw asDisplayError(reason)
        }
      }}
    >
      <AlertBanner tone="warning">
        Os códigos que você guardou antes param de funcionar agora.
      </AlertBanner>
      <ReauthFields value={reauth} onChange={setReauth} />
    </ConfirmModal>
  )
}

function ReplaceAuthenticatorStartModal({
  onClose,
  onStarted,
}: {
  onClose: () => void
  onStarted: (setup: StartAuthenticatorResult) => void
}) {
  const [reauth, setReauth] = useState<ReauthInput>(EMPTY_REAUTH)
  return (
    <ConfirmModal
      title="Substituir aplicativo autenticador"
      description="Você vai cadastrar um autenticador novo. O atual continua valendo até o código novo ser confirmado."
      confirmLabel="Começar substituição"
      confirmDisabled={!reauthReady(reauth)}
      onClose={onClose}
      onConfirm={async () => {
        try {
          onStarted(await ownSecurityApi.startAuthenticatorReplacement(reauth))
        } catch (reason) {
          throw asDisplayError(reason)
        }
      }}
    >
      <AlertBanner tone="info">
        Desistir no meio do caminho não tranca sua conta: nada muda até a
        confirmação. Ao concluir, os códigos de recuperação atuais também são
        trocados e as outras sessões administrativas são encerradas.
      </AlertBanner>
      <ReauthFields value={reauth} onChange={setReauth} />
    </ConfirmModal>
  )
}

function ReplaceAuthenticatorConfirmModal({
  setup,
  onClose,
  onDone,
}: {
  setup: StartAuthenticatorResult
  onClose: () => void
  onDone: (codes: string[]) => void
}) {
  const [code, setCode] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)

  async function submit() {
    if (code.length < 6 || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await ownSecurityApi.confirmAuthenticatorReplacement(
        setup.setupTicket,
        code,
      )
      onDone(result.recoveryCodes)
    } catch (reason) {
      setError(iamErrorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Cadastrar o autenticador novo"
      description="Leia o QR no aplicativo e confirme o código de seis dígitos."
      onClose={onClose}
      width="lg"
      dismissible={!busy}
    >
      <div className="modal-body auth-form">
        <StepProgress steps={["Confirmar identidade", "Ler o QR", "Confirmar código"]} current={2} />
        <AlertBanner tone="info" title="Como ler o código">
          Não use a câmera do sistema. Abra o aplicativo autenticador, escolha
          adicionar conta e leia o QR por ele.
        </AlertBanner>
        <div className="mfa-setup-grid">
          <div className="qr-box">
            <div className="qr-frame">
              <img src={setup.twoFactor.qrCode} alt="QR Code do autenticador" />
            </div>
            <small>Emissor: {setup.twoFactor.issuer}</small>
            <button
              type="button"
              className="text-button"
              onClick={() => setShowKey((current) => !current)}
            >
              {showKey ? "Ocultar chave" : "Não consegue ler? Digitar a chave"}
            </button>
            {showKey && (
              <div className="manual-key-box">
                <div>
                  <span>Chave de configuração</span>
                  <strong className="mono">{setup.twoFactor.secret}</strong>
                </div>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(setup.twoFactor.secret)
                      .then(() => setCopied(true))
                      .catch(() => setCopied(false))
                  }}
                >
                  <Copy size={14} aria-hidden="true" /> {copied ? "Copiada" : "Copiar"}
                </Button>
              </div>
            )}
          </div>
          <div className="mfa-verify-column">
            <h4>Confirme o código do autenticador novo</h4>
            <p>
              Digite o código de seis dígitos que o aplicativo mostra agora para
              a conta recém-adicionada.
            </p>
            <OtpInput value={code} onChange={setCode} error={error} disabled={busy} />
          </div>
        </div>
      </div>
      <footer className="modal-footer">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={() => void submit()} disabled={code.length < 6 || busy} aria-busy={busy}>
          <ShieldCheck size={15} aria-hidden="true" />
          {busy ? "Confirmando..." : "Confirmar e substituir"}
        </Button>
      </footer>
    </Modal>
  )
}
