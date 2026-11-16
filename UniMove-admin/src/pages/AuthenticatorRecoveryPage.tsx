import { useState } from "react"
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react"
import {
  AlertBanner,
  AuthShell,
  OtpInput,
  PasswordInput,
  StepProgress,
  TextInput,
} from "../components/fields"
import { RecoveryCodes } from "../components/RecoveryCodes"
import { Badge, Button } from "../components/ui"
import { mfaRecoveryApi } from "../services/adminIamApi"
import { iamErrorMessage } from "../services/adminIamErrors"
import type { TwoFactorProvisioning } from "../types/admin-iam"

const FOOTER =
  "Nenhum link desativa o segundo fator por si: a recuperação exige senha e aprovação de outro administrador."
const STEPS = ["Confirmar senha", "Ler o QR", "Guardar códigos"]

type Stage =
  | { name: "request" }
  | { name: "requested"; message: string }
  | { name: "start" }
  | { name: "setup"; setup: TwoFactorProvisioning }
  | { name: "codes"; codes: string[] }
  | { name: "done" }

const readToken = () => new URLSearchParams(window.location.search).get("token") ?? ""

export default function AuthenticatorRecoveryPage() {
  const token = readToken()
  const [stage, setStage] = useState<Stage>(
    token ? { name: "start" } : { name: "request" },
  )

  if (stage.name === "requested")
    return (
      <AuthShell subtitle="Recuperação do autenticador" footerNote={FOOTER}>
        <div className="auth-state-block">
          <span className="attention-icon green">
            <CheckCircle2 size={20} aria-hidden="true" />
          </span>
          <h1>Pedido registrado</h1>
          <p>{stage.message}</p>
          <section className="verification-sheet one-col">
            <div>
              <span>O que acontece agora</span>
              <strong>
                Um administrador autorizado revisa o pedido e, se aprovar, você
                recebe por e-mail um link de uso único para cadastrar um
                autenticador novo.
              </strong>
            </div>
          </section>
          <div className="auth-actions">
            <Button onClick={() => window.location.assign("/")}>
              Voltar ao login
            </Button>
          </div>
        </div>
      </AuthShell>
    )

  if (stage.name === "codes")
    return (
      <AuthShell wide subtitle="Recuperação do autenticador" footerNote={FOOTER}>
        <StepProgress steps={STEPS} current={2} />
        <div className="auth-heading">
          <div className="heading-icon-row">
            <span className="attention-icon green">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <Badge tone="amber">Exibição única</Badge>
          </div>
          <h1>Guarde os códigos novos</h1>
          <p>
            Os códigos anteriores deixaram de valer junto com o autenticador
            antigo. Estes são os que valem a partir de agora.
          </p>
        </div>
        <RecoveryCodes
          codes={stage.codes}
          continueLabel="Concluir recuperação"
          onContinue={() => setStage({ name: "done" })}
        />
      </AuthShell>
    )

  if (stage.name === "done")
    return (
      <AuthShell subtitle="Recuperação do autenticador" footerNote={FOOTER}>
        <div className="auth-state-block">
          <span className="attention-icon green">
            <CheckCircle2 size={22} aria-hidden="true" />
          </span>
          <Badge tone="green">Autenticador novo ativo</Badge>
          <h1>Recuperação concluída</h1>
          <p>
            Entre no painel com sua senha e o código do autenticador que você
            acabou de cadastrar. As sessões antigas foram encerradas.
          </p>
          <div className="auth-actions">
            <Button onClick={() => window.location.assign("/")}>
              Ir para o login
            </Button>
          </div>
        </div>
      </AuthShell>
    )

  if (stage.name === "setup")
    return (
      <SetupStage
        setup={stage.setup}
        token={token}
        onDone={(codes) => setStage({ name: "codes", codes })}
      />
    )

  if (stage.name === "start")
    return (
      <StartStage token={token} onStarted={(setup) => setStage({ name: "setup", setup })} />
    )

  return <RequestStage onRequested={(message) => setStage({ name: "requested", message })} />
}

function RequestStage({ onRequested }: { onRequested: (message: string) => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const ready = email.includes("@") && password.length > 0 && reason.trim().length >= 10

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await mfaRecoveryApi.request({
        email: email.trim(),
        password,
        reason: reason.trim(),
      })
      onRequested(result.message)
    } catch (reason_) {
      setError(iamErrorMessage(reason_))
      setBusy(false)
    }
  }

  return (
    <AuthShell wide subtitle="Recuperação do autenticador" footerNote={FOOTER}>
      <div className="auth-heading">
        <h1>Recuperação do autenticador</h1>
        <p>
          Perdeu o acesso ao aplicativo autenticador? Este pedido é diferente da
          recuperação de senha e passa por aprovação de outro administrador.
        </p>
      </div>

      <div className="recovery-method-tabs" role="presentation">
        <div role="presentation">
          <button type="button" aria-selected="true" role="tab">
            <ShieldCheck size={16} aria-hidden="true" />
            <div>
              <strong>Recuperação supervisionada</strong>
              <small>Exige senha e aprovação de um administrador autorizado</small>
            </div>
          </button>
        </div>
        <div role="presentation">
          <button type="button" aria-selected="false" role="tab" disabled>
            <KeyRound size={16} aria-hidden="true" />
            <div>
              <strong>Código de recuperação</strong>
              <small>
                Use um dos códigos guardados diretamente no campo de código do
                login
              </small>
            </div>
          </button>
        </div>
      </div>

      <AlertBanner tone="info" title="Tem um código de recuperação guardado?">
        Não precisa deste pedido. Volte ao login e digite o código de
        recuperação no lugar do código de seis dígitos: ele entra na hora e vale
        uma única vez.
      </AlertBanner>

      {error && <AlertBanner tone="danger">{error}</AlertBanner>}

      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <TextInput
          label="E-mail institucional"
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="nome@ucb.edu.br"
        />
        <PasswordInput
          label="Sua senha"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          name="senha"
          hint="Obrigatória: só o acesso ao e-mail nunca desativa o segundo fator."
        />
        <label className="field">
          <span>Motivo da perda de acesso</span>
          <textarea
            name="motivo"
            value={reason}
            maxLength={500}
            placeholder="Ex.: troca de aparelho sem backup do aplicativo autenticador."
            onChange={(event) => setReason(event.target.value)}
          />
          <small className="field-hint">
            Mínimo de 10 caracteres. O texto vai para a auditoria e para quem
            revisa o pedido.
          </small>
        </label>
        <p className="privacy-note">
          <LockKeyhole size={15} aria-hidden="true" />
          <span>
            O pedido fica registrado na trilha de segurança e precisa da
            aprovação de outro administrador.
          </span>
        </p>
        <div className="auth-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.location.assign("/")}
            disabled={busy}
          >
            <ArrowLeft size={15} aria-hidden="true" /> Voltar ao login
          </Button>
          <Button type="submit" disabled={!ready || busy} aria-busy={busy}>
            {busy ? "Enviando..." : "Solicitar recuperação"}
          </Button>
        </div>
      </form>
    </AuthShell>
  )
}

function StartStage({
  token,
  onStarted,
}: {
  token: string
  onStarted: (setup: TwoFactorProvisioning) => void
}) {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit() {
    if (!password || busy) return
    setBusy(true)
    setError(undefined)
    try {
      onStarted(await mfaRecoveryApi.start(token, password))
    } catch (reason) {
      setError(iamErrorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <AuthShell subtitle="Recuperação do autenticador" footerNote={FOOTER}>
      <StepProgress steps={STEPS} current={0} />
      <div className="auth-heading">
        <Badge tone="green">Pedido aprovado</Badge>
        <h1>Confirme sua senha</h1>
        <p>
          O link sozinho não desativa o segundo fator. Confirme sua senha para
          cadastrar um autenticador novo.
        </p>
      </div>

      <AlertBanner tone="warning" title="O que acontece ao confirmar">
        O autenticador atual e os códigos de recuperação antigos deixam de valer
        imediatamente, e todas as sessões da conta são encerradas.
      </AlertBanner>

      {error && <AlertBanner tone="danger">{error}</AlertBanner>}

      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <PasswordInput
          label="Sua senha"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          name="senha"
        />
        <div className="auth-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.location.assign("/")}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!password || busy} aria-busy={busy}>
            {busy ? "Validando..." : "Continuar"}
          </Button>
        </div>
      </form>
    </AuthShell>
  )
}

function SetupStage({
  setup,
  token,
  onDone,
}: {
  setup: TwoFactorProvisioning
  token: string
  onDone: (codes: string[]) => void
}) {
  const [code, setCode] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit() {
    if (code.length < 6 || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await mfaRecoveryApi.confirm(token, code)
      onDone(result.recoveryCodes)
    } catch (reason) {
      setError(iamErrorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <AuthShell wide subtitle="Recuperação do autenticador" footerNote={FOOTER}>
      <StepProgress steps={STEPS} current={1} />
      <div className="auth-heading">
        <h1>Cadastre o autenticador novo</h1>
        <p>
          Adicione a conta no aplicativo e confirme o código de seis dígitos que
          ele mostrar.
        </p>
      </div>

      <div className="mfa-setup-grid">
        <div className="qr-box">
          <div className="qr-frame">
            <img src={setup.twoFactor.qrCode} alt="QR Code do autenticador" />
          </div>
          <small>{setup.twoFactor.issuer}</small>
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
          <h4>Confirme o código de seis dígitos</h4>
          <p>O autenticador antigo já não vale: use o que você acabou de adicionar.</p>
          <OtpInput value={code} onChange={setCode} error={error} disabled={busy} />
          <div className="auth-actions">
            <Button
              onClick={() => void submit()}
              disabled={code.length < 6 || busy}
              aria-busy={busy}
            >
              <ShieldCheck size={15} aria-hidden="true" />
              {busy ? "Confirmando..." : "Confirmar e concluir"}
            </Button>
          </div>
        </div>
      </div>
    </AuthShell>
  )
}
