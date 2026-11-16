import { useState } from "react"
import { ArrowLeft, CheckCircle2, MailCheck } from "lucide-react"
import {
  AlertBanner,
  AuthShell,
  PasswordChecklist,
  PasswordInput,
  TextInput,
  passwordMeetsPolicy,
} from "../components/fields"
import { Badge, Button } from "../components/ui"
import { passwordResetApi } from "../services/adminIamApi"
import { iamErrorMessage } from "../services/adminIamErrors"

const FOOTER = "Redefinir a senha não desativa a autenticação em duas etapas."

type Stage =
  | { name: "request" }
  | { name: "sent"; message: string }
  | { name: "reset" }
  | { name: "done" }

const readToken = () => new URLSearchParams(window.location.search).get("token") ?? ""

export default function PasswordResetPage() {
  const token = readToken()
  const [stage, setStage] = useState<Stage>(token ? { name: "reset" } : { name: "request" })

  if (stage.name === "sent")
    return (
      <AuthShell subtitle="Recuperação de credencial" footerNote={FOOTER}>
        <div className="auth-state-block">
          <span className="attention-icon green">
            <MailCheck size={20} aria-hidden="true" />
          </span>
          <h1>Solicitação registrada</h1>
          <p>{stage.message}</p>
          <div className="auth-actions">
            <Button onClick={() => window.location.assign("/")}>
              Voltar ao login
            </Button>
          </div>
        </div>
      </AuthShell>
    )

  if (stage.name === "done")
    return (
      <AuthShell subtitle="Recuperação de credencial" footerNote={FOOTER}>
        <div className="auth-state-block">
          <span className="attention-icon green">
            <CheckCircle2 size={21} aria-hidden="true" />
          </span>
          <Badge tone="green">Senha atualizada</Badge>
          <h1>Sua nova senha já vale</h1>
          <p>
            Todas as sessões anteriores foram encerradas. Para entrar, faça login
            e confirme o código do aplicativo autenticador — o segundo fator
            continua obrigatório.
          </p>
          <div className="auth-actions">
            <Button onClick={() => window.location.assign("/")}>
              Ir para o login
            </Button>
          </div>
        </div>
      </AuthShell>
    )

  if (stage.name === "reset")
    return (
      <ResetStage
        token={token}
        onDone={() => setStage({ name: "done" })}
        onRestart={() => setStage({ name: "request" })}
      />
    )

  return <RequestStage onSent={(message) => setStage({ name: "sent", message })} />
}

function RequestStage({ onSent }: { onSent: (message: string) => void }) {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit() {
    if (!email.includes("@") || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await passwordResetApi.request(email.trim())
      onSent(result.message)
    } catch (reason) {
      setError(iamErrorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <AuthShell subtitle="Recuperação de credencial" footerNote={FOOTER}>
      <div className="auth-heading">
        <h1>Recuperar senha administrativa</h1>
        <p>
          Informe seu e-mail institucional para receber um link temporário. Por
          segurança, não informamos se um endereço está cadastrado.
        </p>
      </div>

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
        <div className="auth-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.location.assign("/")}
            disabled={busy}
          >
            <ArrowLeft size={15} aria-hidden="true" /> Voltar ao login
          </Button>
          <Button type="submit" disabled={!email.includes("@") || busy} aria-busy={busy}>
            {busy ? "Enviando..." : "Enviar solicitação"}
          </Button>
        </div>
      </form>
    </AuthShell>
  )
}

function ResetStage({
  token,
  onDone,
  onRestart,
}: {
  token: string
  onDone: () => void
  onRestart: () => void
}) {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [dead, setDead] = useState(false)

  const ready = passwordMeetsPolicy(password) && password === confirmation && !busy

  async function submit() {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    try {
      await passwordResetApi.confirm(token, password)
      onDone()
    } catch (reason) {
      const message = iamErrorMessage(reason)
      // Link que não vale mais não é erro de digitação: abre o caminho de pedir outro.
      if (message.includes("link")) setDead(true)
      setError(message)
      setBusy(false)
    }
  }

  if (dead)
    return (
      <AuthShell subtitle="Recuperação de credencial" footerNote={FOOTER}>
        <div className="auth-state-block">
          <span className="attention-icon amber">
            <MailCheck size={20} aria-hidden="true" />
          </span>
          <h1>Este link não vale mais</h1>
          <p>{error}</p>
          <div className="auth-actions">
            <Button variant="secondary" onClick={() => window.location.assign("/")}>
              Voltar ao login
            </Button>
            <Button onClick={onRestart}>Solicitar novo link</Button>
          </div>
        </div>
      </AuthShell>
    )

  return (
    <AuthShell subtitle="Recuperação de credencial" footerNote={FOOTER}>
      <div className="auth-heading">
        <Badge tone="green">Link validado • Uso único</Badge>
        <h1>Definir nova senha</h1>
        <p>
          Ao concluir, todas as sessões abertas serão encerradas e o segundo
          fator continuará sendo exigido no login.
        </p>
      </div>

      {error && !dead && <AlertBanner tone="danger">{error}</AlertBanner>}

      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <PasswordInput
          label="Nova senha"
          value={password}
          onChange={setPassword}
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
            confirmation.length > 0 && confirmation !== password
              ? "A confirmação precisa ser idêntica à nova senha."
              : undefined
          }
        />
        <PasswordChecklist password={password} confirmation={confirmation} />
        <div className="auth-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.location.assign("/")}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!ready} aria-busy={busy}>
            {busy ? "Salvando..." : "Salvar nova senha"}
          </Button>
        </div>
      </form>
    </AuthShell>
  )
}
