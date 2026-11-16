import { type FormEvent, useState } from "react"
import { ArrowLeft, KeyRound, Smartphone } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { adminPath } from "../hooks/useRoute"
import {
  AlertBanner,
  AuthShell,
  OtpInput,
  PasswordInput,
  TextInput,
} from "../components/fields"
import { RecoveryCodes } from "../components/RecoveryCodes"
import { Badge, Button } from "../components/ui"
import { authApi } from "../services/adminApi"
import { iamErrorMessage } from "../services/adminIamErrors"
import type { SecondFactorResult, SessionUser } from "../types/api"

const FOOTER =
  "Acesso restrito à equipe autorizada. Administradores são cadastrados exclusivamente por convite."

type Step =
  | { name: "credentials" }
  | { name: "code" }
  | { name: "recovery"; codes: string[]; user: SessionUser }

/**
 * Login administrativo no desenho do Figma Make. O fluxo é o que já existia e
 * foi testado — senha, segundo fator e, quando a API devolve códigos novos,
 * a entrega única antes de abrir o painel. O que mudou foi a moldura e os
 * campos: `AuthShell`, `PasswordInput` e as seis casas do `OtpInput`.
 *
 * O campo de código aceita o TOTP de seis dígitos e também um código de
 * recuperação, que é como a API funciona: o formato decide qual é qual.
 */
export default function LoginPage() {
  const { completeLogin, notice } = useAuth()
  const [step, setStep] = useState<Step>({ name: "credentials" })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [recoveryCode, setRecoveryCode] = useState("")
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (reason) {
      setError(iamErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  function submitCredentials(event: FormEvent) {
    event.preventDefault()
    void attempt(async () => {
      await authApi.login(email.trim(), password)
      // A senha não precisa ficar na memória do formulário depois desta etapa.
      setPassword("")
      setCode("")
      setRecoveryCode("")
      setUseRecoveryCode(false)
      setStep({ name: "code" })
    })
  }

  function submitCode(event: FormEvent) {
    event.preventDefault()
    void attempt(async () => {
      const value = useRecoveryCode ? recoveryCode.trim() : code.trim()
      const result: SecondFactorResult = await authApi.secondFactor(value)
      if (result.recoveryCodes?.length)
        setStep({ name: "recovery", codes: result.recoveryCodes, user: result.user })
      else completeLogin(result.user)
    })
  }

  function backToCredentials() {
    setStep({ name: "credentials" })
    setCode("")
    setRecoveryCode("")
    setUseRecoveryCode(false)
    setError(undefined)
  }

  if (step.name === "recovery")
    return (
      <AuthShell wide subtitle="Códigos de recuperação" footerNote={FOOTER}>
        <div className="auth-heading">
          <Badge tone="amber">Exibição única</Badge>
          <h1>Guarde seus códigos de recuperação</h1>
          <p>
            Eles substituem o aplicativo autenticador se você perder o acesso a
            ele. Cada código vale uma única vez.
          </p>
        </div>
        <RecoveryCodes
          codes={step.codes}
          continueLabel="Entrar no painel"
          onContinue={() => completeLogin(step.user)}
        />
      </AuthShell>
    )

  if (step.name === "code")
    return (
      <AuthShell subtitle="Segundo fator" footerNote={FOOTER}>
        <div className="auth-heading">
          <div className="heading-icon-row">
            <span className="attention-icon blue">
              <Smartphone size={18} aria-hidden="true" />
            </span>
            <Badge tone="blue">{email}</Badge>
          </div>
          <h1>Verificação em duas etapas</h1>
          <p>
            {useRecoveryCode
              ? "Digite um dos códigos de recuperação que você guardou. Ele vale uma única vez."
              : "Digite o código de seis dígitos do seu aplicativo autenticador. Colar o código completo também funciona."}
          </p>
        </div>

        {error && <AlertBanner tone="danger">{error}</AlertBanner>}

        <form className="auth-form" onSubmit={submitCode}>
          {useRecoveryCode ? (
            <TextInput
              label="Código de recuperação"
              name="codigo-recuperacao"
              autoComplete="one-time-code"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
            />
          ) : (
            <OtpInput value={code} onChange={setCode} disabled={busy} />
          )}
          <div className="auth-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={backToCredentials}
              disabled={busy}
            >
              <ArrowLeft size={15} aria-hidden="true" /> Voltar
            </Button>
            <Button
              type="submit"
              disabled={busy || (useRecoveryCode ? recoveryCode.length < 10 : code.length < 6)}
              aria-busy={busy}
            >
              {busy ? "Verificando..." : "Verificar"}
            </Button>
          </div>
        </form>

        <div className="auth-secondary-links">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setUseRecoveryCode((current) => !current)
              setError(undefined)
            }}
          >
            <KeyRound size={14} aria-hidden="true" />
            {useRecoveryCode
              ? "Usar o código do autenticador"
              : "Usar um código de recuperação"}
          </button>
        </div>
        <div className="auth-secondary-links">
          <a className="text-button" href={adminPath("/recuperar-autenticador")}>
            Perdi o acesso ao autenticador
          </a>
        </div>
      </AuthShell>
    )

  return (
    <AuthShell subtitle="Acesso administrativo" footerNote={FOOTER}>
      <div className="auth-heading">
        <h1>Acessar o painel administrativo</h1>
        <p>
          Entre com sua conta institucional. Na etapa seguinte pediremos o
          código de verificação em duas etapas.
        </p>
      </div>

      {notice && <AlertBanner tone="info">{notice}</AlertBanner>}
      {error && <AlertBanner tone="danger">{error}</AlertBanner>}

      <form className="auth-form" onSubmit={submitCredentials}>
        <TextInput
          label="E-mail institucional"
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="nome@ucb.edu.br"
        />
        <div className="password-with-link">
          <PasswordInput
            label="Senha"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            name="senha"
          />
          <a className="forgot-link" href={adminPath("/redefinir-senha")}>
            Esqueci minha senha
          </a>
        </div>
        <div className="auth-actions full">
          <Button type="submit" disabled={busy || !email || !password} aria-busy={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </Button>
        </div>
      </form>
    </AuthShell>
  )
}
