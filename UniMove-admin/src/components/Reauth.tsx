import { LockKeyhole } from "lucide-react"
import type { ReauthInput } from "../types/admin-iam"
import { OtpInput, PasswordInput } from "./fields"

export const EMPTY_REAUTH: ReauthInput = { password: "", twoFactorCode: "" }

export const reauthReady = (value: ReauthInput) =>
  value.password.length > 0 && /^\d{6}$/.test(value.twoFactorCode)

/**
 * Senha e código do autenticador no mesmo passo, como o servidor exige em toda
 * operação que muda quem tem acesso.
 *
 * O código é consumido: não serve duas vezes. Quem acabou de entrar vê o mesmo
 * número no aplicativo e recebe `ADMIN_REAUTH_CODE_ALREADY_USED` — por isso o
 * aviso abaixo fala de "código atual", e a mensagem de erro que o servidor
 * devolve nesse caso manda aguardar o próximo, não conferir a senha.
 */
export function ReauthFields({
  value,
  onChange,
  disabled = false,
}: {
  value: ReauthInput
  onChange: (next: ReauthInput) => void
  disabled?: boolean
}) {
  return (
    <div className="auth-form">
      <p className="privacy-note">
        <LockKeyhole size={15} aria-hidden="true" />
        <span>
          Confirme sua identidade: digite sua senha e o código atual do seu
          aplicativo autenticador.
        </span>
      </p>
      <PasswordInput
        label="Sua senha"
        name="senha-reautenticacao"
        autoComplete="current-password"
        value={value.password}
        onChange={(password) => onChange({ ...value, password })}
      />
      <div className="field">
        <span>Código do autenticador</span>
        <OtpInput
          label="Código atual do autenticador"
          value={value.twoFactorCode}
          disabled={disabled}
          onChange={(twoFactorCode) => onChange({ ...value, twoFactorCode })}
        />
      </div>
    </div>
  )
}
