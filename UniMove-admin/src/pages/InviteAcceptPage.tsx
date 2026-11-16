import { useEffect, useState } from "react"
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react"
import {
  AlertBanner,
  AuthShell,
  OtpInput,
  PasswordChecklist,
  PasswordInput,
  StepProgress,
  TextInput,
  passwordMeetsPolicy,
} from "../components/fields"
import { RecoveryCodes } from "../components/RecoveryCodes"
import { Badge, Button, Loading } from "../components/ui"
import { formatDateTime } from "../lib/format"
import { inviteAcceptanceApi, permissionsApi } from "../services/adminIamApi"
import { iamErrorMessage } from "../services/adminIamErrors"
import type {
  AdminPermissionInfo,
  InvitePreview,
  TwoFactorProvisioning,
} from "../types/admin-iam"

const STEPS = ["Confirmar convite", "Definir senha", "Ativar 2FA", "Guardar códigos"]
const FOOTER =
  "O acesso administrativo é concedido somente por convite nominal e exige o segundo fator ativo."

type Stage =
  | { name: "loading" }
  | { name: "invalid"; message: string }
  | { name: "preview"; invite: InvitePreview }
  | { name: "password"; invite: InvitePreview }
  | { name: "two-factor"; invite: InvitePreview; setup: TwoFactorProvisioning }
  | { name: "codes"; codes: string[] }
  | { name: "done" }

/** O token vem na busca, nunca no caminho: não vai para log de servidor. */
const readToken = () => new URLSearchParams(window.location.search).get("token") ?? ""

export default function InviteAcceptPage() {
  const [stage, setStage] = useState<Stage>({ name: "loading" })
  const [catalog, setCatalog] = useState<AdminPermissionInfo[]>([])
  const token = readToken()

  useEffect(() => {
    if (!token) {
      setStage({
        name: "invalid",
        message:
          "O endereço não tem o código do convite. Abra o link exatamente como ele chegou no e-mail.",
      })
      return
    }
    let active = true
    void inviteAcceptanceApi
      .confirmEmail(token)
      .then((invite) => {
        if (active) setStage({ name: "preview", invite })
      })
      .catch((reason: unknown) => {
        if (active) setStage({ name: "invalid", message: iamErrorMessage(reason) })
      })
    return () => {
      active = false
    }
  }, [token])

  // O catálogo é público só no sentido de ser rotulagem: se a sessão não existe,
  // a chamada falha e a tela mostra o código da permissão, sem quebrar.
  useEffect(() => {
    void permissionsApi
      .catalog()
      .then(setCatalog)
      .catch(() => setCatalog([]))
  }, [])

  const labelOf = (permission: string) =>
    catalog.find((item) => item.value === permission)?.label ?? permission

  if (stage.name === "loading")
    return (
      <AuthShell subtitle="Convite administrativo" footerNote={FOOTER}>
        <Loading label="Validando o convite..." />
      </AuthShell>
    )

  if (stage.name === "invalid")
    return (
      <AuthShell subtitle="Convite administrativo" footerNote={FOOTER}>
        <div className="auth-state-block">
          <span className="attention-icon red">
            <ShieldAlert size={20} aria-hidden="true" />
          </span>
          <h1>Convite indisponível</h1>
          <p>{stage.message}</p>
          <div className="auth-actions">
            <Button onClick={() => window.location.assign("/")}>
              Ir para o login administrativo
            </Button>
          </div>
        </div>
      </AuthShell>
    )

  if (stage.name === "codes")
    return (
      <AuthShell wide subtitle="Convite administrativo" footerNote={FOOTER}>
        <StepProgress steps={STEPS} current={3} />
        <div className="auth-heading">
          <div className="heading-icon-row">
            <span className="attention-icon green">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <Badge tone="amber">Exibição única</Badge>
          </div>
          <h1>Guarde seus códigos de recuperação</h1>
          <p>
            Eles servem para entrar se você perder o aplicativo autenticador.
            Cada código vale uma única vez.
          </p>
        </div>
        <RecoveryCodes
          codes={stage.codes}
          continueLabel="Concluir ativação"
          onContinue={() => setStage({ name: "done" })}
        />
      </AuthShell>
    )

  if (stage.name === "done")
    return (
      <AuthShell subtitle="Convite administrativo" footerNote={FOOTER}>
        <div className="auth-state-block">
          <span className="attention-icon green">
            <CheckCircle2 size={22} aria-hidden="true" />
          </span>
          <Badge tone="green">Acesso concedido • Segundo fator ativo</Badge>
          <h1>Sua conta está pronta</h1>
          <p>
            Entre no painel com seu e-mail, a senha que você definiu e o código
            do aplicativo autenticador.
          </p>
          <div className="auth-actions">
            <Button onClick={() => window.location.assign("/")}>
              Ir para o login
            </Button>
          </div>
        </div>
      </AuthShell>
    )

  if (stage.name === "preview") {
    const { invite } = stage
    return (
      <AuthShell subtitle="Convite administrativo" footerNote={FOOTER}>
        <StepProgress steps={STEPS} current={0} />
        <div className="auth-heading">
          <Badge tone="green">Convite pessoal • Uso único</Badge>
          <h1>Você foi convidado para administrar o UniCarona</h1>
          <p>
            Para ativar sua credencial, confira os dados abaixo, defina sua senha
            e configure a autenticação em duas etapas.
          </p>
        </div>
        <section className="verification-sheet">
          <div>
            <span>E-mail do convite</span>
            <strong>{invite.email}</strong>
          </div>
          <div>
            <span>Nome registrado</span>
            <strong>{invite.fullName}</strong>
          </div>
          <div>
            <span>Validade</span>
            <strong>{formatDateTime(invite.expiresAt)}</strong>
          </div>
          <div>
            <span>Conta nesta plataforma</span>
            <strong>{invite.accountExists ? "Já existe" : "Será criada agora"}</strong>
          </div>
        </section>
        <div className="security-guidelines">
          <h4>
            {invite.permissions.length
              ? "Permissões que este convite concede"
              : "Este convite não concede nenhuma permissão"}
          </h4>
          <ul>
            {invite.permissions.length ? (
              invite.permissions.map((permission) => (
                <li key={permission}>
                  <Check size={14} aria-hidden="true" /> {labelOf(permission)}
                </li>
              ))
            ) : (
              <li>
                <Check size={14} aria-hidden="true" /> Você entrará no painel sem
                poder gerenciar acessos. Um administrador pode ajustar depois.
              </li>
            )}
          </ul>
        </div>
        <div className="security-guidelines">
          <h4>Antes de continuar</h4>
          <ul>
            <li>
              <Check size={14} aria-hidden="true" /> O link é pessoal e vinculado
              ao endereço acima.
            </li>
            <li>
              <Check size={14} aria-hidden="true" /> O painel só abre depois de
              você ativar o segundo fator.
            </li>
            <li>
              <Check size={14} aria-hidden="true" /> Toda operação administrativa
              fica registrada na auditoria.
            </li>
          </ul>
        </div>
        <div className="auth-actions">
          <Button onClick={() => setStage({ name: "password", invite })}>
            Continuar
          </Button>
        </div>
      </AuthShell>
    )
  }

  if (stage.name === "password")
    return (
      <PasswordStage
        invite={stage.invite}
        token={token}
        onBack={() => setStage({ name: "preview", invite: stage.invite })}
        onReady={(setup) =>
          setStage({ name: "two-factor", invite: stage.invite, setup })
        }
        onInvalid={(message) => setStage({ name: "invalid", message })}
      />
    )

  return (
    <TwoFactorStage
      invite={stage.invite}
      setup={stage.setup}
      token={token}
      onDone={(codes) => setStage({ name: "codes", codes })}
      onInvalid={(message) => setStage({ name: "invalid", message })}
    />
  )
}

function PasswordStage({
  invite,
  token,
  onBack,
  onReady,
  onInvalid,
}: {
  invite: InvitePreview
  token: string
  onBack: () => void
  onReady: (setup: TwoFactorProvisioning) => void
  onInvalid: (message: string) => void
}) {
  const [cpf, setCpf] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const ready = invite.accountExists
    ? currentPassword.length > 0
    : cpf.replace(/\D/g, "").length === 11 &&
      passwordMeetsPolicy(password) &&
      password === confirmation

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const setup = await inviteAcceptanceApi.setPassword(
        invite.accountExists
          ? { token, currentPassword }
          : { token, cpf: cpf.replace(/\D/g, ""), password },
      )
      onReady(setup)
    } catch (reason) {
      const message = iamErrorMessage(reason)
      // Convite que deixou de valer no meio do caminho não é erro de digitação.
      if (message.includes("convite")) onInvalid(message)
      else setError(message)
      setBusy(false)
    }
  }

  return (
    <AuthShell subtitle="Convite administrativo" footerNote={FOOTER}>
      <StepProgress steps={STEPS} current={1} />
      <div className="auth-heading">
        <h1>
          {invite.accountExists ? "Confirme sua senha atual" : "Defina sua senha"}
        </h1>
        <p>
          {invite.accountExists ? (
            <>
              Já existe uma conta para <strong>{invite.email}</strong> nesta
              plataforma. Confirme a senha dela: o convite promove a conta e não
              troca sua senha.
            </>
          ) : (
            <>
              Criando a credencial administrativa de <strong>{invite.email}</strong>.
            </>
          )}
        </p>
      </div>

      {error && <AlertBanner tone="danger">{error}</AlertBanner>}

      <div className="auth-form">
        {invite.accountExists ? (
          <PasswordInput
            label="Senha atual da sua conta"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            name="senha-atual"
          />
        ) : (
          <>
            <TextInput
              label="CPF"
              inputMode="numeric"
              value={cpf}
              onChange={(event) => setCpf(event.target.value)}
              placeholder="Somente números"
              hint="Usado apenas para identificar a conta na plataforma."
            />
            <PasswordInput
              label="Nova senha"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              name="senha-nova"
            />
            <PasswordInput
              label="Confirmar senha"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
              name="senha-confirmacao"
              error={
                confirmation.length > 0 && confirmation !== password
                  ? "A confirmação precisa ser idêntica à senha."
                  : undefined
              }
            />
            <PasswordChecklist password={password} confirmation={confirmation} />
          </>
        )}
      </div>

      <div className="auth-actions">
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          <ArrowLeft size={15} aria-hidden="true" /> Voltar
        </Button>
        <Button onClick={() => void submit()} disabled={!ready || busy} aria-busy={busy}>
          {busy ? "Validando..." : "Continuar"}
        </Button>
      </div>
    </AuthShell>
  )
}

function TwoFactorStage({
  invite,
  setup,
  token,
  onDone,
  onInvalid,
}: {
  invite: InvitePreview
  setup: TwoFactorProvisioning
  token: string
  onDone: (codes: string[]) => void
  onInvalid: (message: string) => void
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
      const result = await inviteAcceptanceApi.confirmTwoFactor(token, code)
      onDone(result.recoveryCodes)
    } catch (reason) {
      const message = iamErrorMessage(reason)
      if (message.includes("convite")) onInvalid(message)
      else setError(message)
      setBusy(false)
    }
  }

  return (
    <AuthShell wide subtitle="Convite administrativo" footerNote={FOOTER}>
      <StepProgress steps={STEPS} current={2} />
      <div className="auth-heading">
        <h1>Proteja sua conta</h1>
        <p>
          A autenticação em duas etapas é obrigatória. Vincule um aplicativo
          autenticador antes de o painel abrir.
        </p>
      </div>

      <AlertBanner tone="info" title="Como ler o código">
        Não use a câmera do sistema. Abra o <strong>Google Authenticator</strong>,
        o <strong>Microsoft Authenticator</strong> ou outro aplicativo compatível,
        escolha adicionar conta e leia o QR por ele.
      </AlertBanner>

      <div className="mfa-setup-grid">
        <div className="qr-box">
          <div className="qr-frame">
            <img src={setup.twoFactor.qrCode} alt="QR Code do autenticador" />
          </div>
          <small>
            {setup.twoFactor.issuer} • {invite.email}
          </small>
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
          <p>
            Depois de adicionar a conta no aplicativo, digite o código que ele
            mostra agora.
          </p>
          <OtpInput value={code} onChange={setCode} error={error} disabled={busy} />
          <div className="auth-actions">
            <Button
              onClick={() => void submit()}
              disabled={code.length < 6 || busy}
              aria-busy={busy}
            >
              <ShieldCheck size={15} aria-hidden="true" />
              {busy ? "Ativando..." : "Verificar e ativar"}
            </Button>
          </div>
        </div>
      </div>
    </AuthShell>
  )
}
