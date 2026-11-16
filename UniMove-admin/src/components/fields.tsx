import { type ReactNode, useId, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  MoreHorizontal,
  Route,
  ShieldAlert,
} from "lucide-react"
import { cn } from "./ui"

/**
 * Campos e molduras das telas de acesso e segurança, no desenho do Figma Make.
 *
 * Ficam fora de `ui.tsx` de propósito: aquele arquivo atende as telas de
 * operação que já existiam, e misturar os dois deixaria qualquer um deles
 * grande demais para ler. `cn`, Button, Badge e Modal continuam vindo de lá.
 */

/**
 * Rótulo ligado por `htmlFor`, com a dica e o erro **fora** do `<label>`.
 *
 * Envolver a dica no rótulo faria o leitor de tela anunciar o texto de ajuda
 * como parte do nome do campo ("E-mail institucional O convite vale apenas
 * para..."), em vez de como descrição. A dica entra por `aria-describedby`,
 * que é onde ela pertence.
 */
export function TextInput({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
}) {
  const generated = useId()
  const fieldId = id ?? generated
  const hintId = `${fieldId}-hint`
  return (
    <div className={cn("field", className)}>
      <label htmlFor={fieldId}>
        <span>{label}</span>
      </label>
      <input
        id={fieldId}
        className={cn(error && "input-error")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? hintId : undefined}
        {...props}
      />
      {error ? (
        <small className="field-error" id={hintId} role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className="field-hint" id={hintId}>
          {hint}
        </small>
      ) : null}
    </div>
  )
}

export function PasswordInput({
  label,
  hint,
  error,
  value,
  onChange,
  autoComplete,
  name,
}: {
  label: string
  hint?: string
  error?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  name?: string
}) {
  const [visible, setVisible] = useState(false)
  const fieldId = useId()
  const hintId = `${fieldId}-hint`
  return (
    <div className="field">
      <label htmlFor={fieldId}>
        <span>{label}</span>
      </label>
      <div className={cn("password-field", error && "input-error")}>
        <input
          id={fieldId}
          type={visible ? "text" : "password"}
          name={name}
          value={value}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        >
          {visible ? (
            <EyeOff size={15} aria-hidden="true" />
          ) : (
            <Eye size={15} aria-hidden="true" />
          )}
          <span aria-hidden="true">{visible ? "Ocultar" : "Mostrar"}</span>
        </button>
      </div>
      {error ? (
        <small className="field-error" id={hintId} role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className="field-hint" id={hintId}>
          {hint}
        </small>
      ) : null}
    </div>
  )
}

/**
 * Seis casas para o código do autenticador. Colar o código inteiro preenche
 * tudo de uma vez, que é como a pessoa usa de verdade: o aplicativo copia os
 * seis dígitos juntos.
 */
export function OtpInput({
  value,
  onChange,
  error,
  label = "Código de 6 dígitos",
  disabled = false,
}: {
  value: string
  onChange: (next: string) => void
  error?: string
  label?: string
  disabled?: boolean
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const errorId = useId()
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "")

  const write = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, "")
    const next = [...digits]
    if (!clean) {
      next[index] = ""
      onChange(next.join(""))
      return
    }
    for (let offset = 0; offset < clean.length && index + offset < 6; offset += 1)
      next[index + offset] = clean[offset]
    onChange(next.join(""))
    refs.current[Math.min(5, index + clean.length)]?.focus()
  }

  return (
    <div className="otp-group">
      <div className="otp-inputs" role="group" aria-label={label}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={6}
            value={digit}
            disabled={disabled}
            aria-label={`Dígito ${index + 1} de 6`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn("otp-slot", error && "input-error")}
            onChange={(event) => write(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !digit && index > 0)
                refs.current[index - 1]?.focus()
              if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus()
              if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus()
            }}
            onPaste={(event) => {
              event.preventDefault()
              const pasted = event.clipboardData
                .getData("text")
                .replace(/\D/g, "")
                .slice(0, 6)
              if (!pasted) return
              onChange(pasted)
              refs.current[Math.min(5, pasted.length - 1)]?.focus()
            }}
          />
        ))}
      </div>
      {error && (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      )}
    </div>
  )
}

export function AlertBanner({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger"
  title?: string
  children: ReactNode
}) {
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "danger"
        ? ShieldAlert
        : tone === "warning"
          ? AlertTriangle
          : Info
  return (
    <div
      className={cn("alert-banner", `alert-${tone}`)}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon size={17} aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        <p>{children}</p>
      </div>
    </div>
  )
}

export function StepProgress({
  steps,
  current,
}: {
  steps: string[]
  current: number
}) {
  return (
    <ol className="step-progress" aria-label="Progresso da ativação">
      {steps.map((label, index) => {
        const state =
          index < current ? "done" : index === current ? "current" : "upcoming"
        return (
          <li key={label} className={cn("step-item", `step-${state}`)}>
            <span className="step-index" aria-hidden="true">
              {index < current ? <Check size={12} /> : index + 1}
            </span>
            <span>{label}</span>
            {index === current && <span className="sr-only">(etapa atual)</span>}
          </li>
        )
      })}
    </ol>
  )
}

export type ContextMenuItem = {
  label: string
  onClick: () => void
  danger?: boolean
}

/** Menu de ações da linha. Clique fora e Escape fecham. */
export function ContextMenu({
  items,
  ariaLabel = "Ações do registro",
}: {
  items: ContextMenuItem[]
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <div className="context-menu-wrap">
      <button
        type="button"
        className="icon-button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={17} aria-hidden="true" />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="context-backdrop"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
          />
          <div
            className="context-menu"
            role="menu"
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false)
            }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={cn(item.danger && "danger")}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Moldura das telas que acontecem fora da sessão: aceite de convite, login,
 * redefinição de senha e recuperação do autenticador.
 */
export function AuthShell({
  children,
  subtitle = "Acesso administrativo e segurança",
  wide = false,
  footerNote,
}: {
  children: ReactNode
  subtitle?: string
  wide?: boolean
  footerNote?: string
}) {
  return (
    <div className="auth-screen">
      <section className={cn("auth-card auth-shell", wide && "auth-card-wide")}>
        <header className="auth-brand-header">
          <div className="brand-inline">
            <div className="brand-mark">
              <Route size={18} aria-hidden="true" />
            </div>
            <div>
              <strong>UniCarona</strong>
              <span>ADMIN</span>
            </div>
          </div>
          <small className="auth-subtitle-tag">{subtitle}</small>
        </header>
        <div className="auth-card-body">{children}</div>
        {footerNote && <footer className="auth-card-footer">{footerNote}</footer>}
      </section>
    </div>
  )
}

/** Requisitos de senha conferidos na tela, com a mesma regra do servidor. */
export const PASSWORD_RULES = [
  { label: "Mínimo de 8 caracteres", test: (value: string) => value.length >= 8 },
  { label: "Uma letra maiúscula", test: (value: string) => /[A-Z]/.test(value) },
  { label: "Uma letra minúscula", test: (value: string) => /[a-z]/.test(value) },
  { label: "Um número", test: (value: string) => /\d/.test(value) },
  {
    label: "Um caractere especial",
    test: (value: string) => /[^A-Za-z0-9]/.test(value),
  },
] as const

export const passwordMeetsPolicy = (value: string) =>
  PASSWORD_RULES.every((rule) => rule.test(value))

export function PasswordChecklist({
  password,
  confirmation,
}: {
  password: string
  confirmation?: string
}) {
  const rules = [
    ...PASSWORD_RULES.map((rule) => ({ label: rule.label, ok: rule.test(password) })),
    ...(confirmation === undefined
      ? []
      : [
          {
            label: "Confirmação idêntica",
            ok: password.length > 0 && password === confirmation,
          },
        ]),
  ]
  return (
    <div className="password-checklist" aria-live="polite">
      <span>Requisitos de segurança</span>
      <ul>
        {rules.map((rule) => (
          <li key={rule.label} className={cn(rule.ok && "valid")}>
            <span className="check-indicator" aria-hidden="true">
              {rule.ok ? <Check size={11} /> : null}
            </span>
            {rule.label}
            <span className="sr-only">{rule.ok ? ": atendido" : ": pendente"}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
