import { LockKeyhole } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { Badge, Button, PageIntro, Select } from "../components/ui"
import { roleLabel } from "../lib/labels"
import { usePreferences } from "../preferences/PreferencesContext"

export default function SettingsPage() {
  const { user, logout } = useAuth()
  const { preferences, savedLocally, updatePreferences, resetPreferences } =
    usePreferences()
  if (!user) return null
  const recoveryLeft = user.recoveryCodesRemaining ?? 0
  return (
    <>
      <PageIntro
        title="Configurações"
        description="Sua conta administrativa e como o painel aparece neste navegador."
      />
      <div className="settings-content">
        <section className="panel settings-section">
          <div className="section-heading">
            <div>
              <h2>Conta</h2>
              <p>Dados exibidos no histórico administrativo</p>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Nome completo</dt>
              <dd>{user.fullName}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Perfis</dt>
              <dd>{user.roles.map((role) => roleLabel[role]).join(", ")}</dd>
            </div>
          </dl>
        </section>
        <section className="panel settings-section">
          <div className="section-heading">
            <div>
              <h2>Preferências de interface</h2>
              <p>Ajuste a leitura e a organização do painel</p>
            </div>
          </div>
          <div className="preference-select">
            <span>
              <strong>Tamanho do texto</strong>
              <small>Aplicado em todas as páginas do painel.</small>
            </span>
            <Select
              ariaLabel="Tamanho do texto"
              value={preferences.textSize}
              highlightActive={false}
              onChange={(value) =>
                updatePreferences({
                  textSize: value === "large" ? "large" : "standard",
                })
              }
            >
              <option value="standard">Padrão</option>
              <option value="large">Ampliado</option>
            </Select>
          </div>
          <label className="toggle-row">
            <span>
              <strong>Tabelas compactas</strong>
              <small>
                Reduz o espaço entre as linhas, mantendo o tamanho do texto.
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Tabelas compactas"
              checked={preferences.compactTables}
              onChange={(event) =>
                updatePreferences({ compactTables: event.target.checked })
              }
            />
            <i aria-hidden="true" />
          </label>
          <label className="toggle-row">
            <span>
              <strong>Recolher menu lateral</strong>
              <small>Exibe apenas os ícones em telas grandes.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Recolher menu lateral"
              checked={preferences.sidebarCollapsed}
              onChange={(event) =>
                updatePreferences({ sidebarCollapsed: event.target.checked })
              }
            />
            <i aria-hidden="true" />
          </label>
          <div className="preferences-footer">
            <p role="status">
              {savedLocally
                ? "Preferências salvas neste navegador."
                : "Preferências aplicadas nesta sessão. O navegador bloqueou o armazenamento."}
            </p>
            <Button variant="secondary" onClick={resetPreferences}>
              Restaurar preferências
            </Button>
          </div>
        </section>
        <section className="panel settings-section">
          <div className="section-heading">
            <div>
              <h2>Segurança</h2>
              <p>Proteções ativas no acesso administrativo</p>
            </div>
          </div>
          <div className="security-row">
            <span>
              <strong>Autenticação em dois fatores ativa</strong>
              <small>
                {recoveryLeft === 1
                  ? "1 código de recuperação disponível"
                  : `${recoveryLeft} códigos de recuperação disponíveis`}
              </small>
            </span>
            <Badge tone={recoveryLeft > 2 ? "green" : "amber"}>
              {recoveryLeft > 2 ? "Protegida" : "Poucos códigos"}
            </Badge>
          </div>
          <div className="security-actions">
            <Button variant="secondary" onClick={() => void logout()}>
              <LockKeyhole size={15} aria-hidden="true" /> Sair do painel
            </Button>
          </div>
        </section>
        <p className="version-note">UniCarona Admin, versão 1.0.0</p>
      </div>
    </>
  )
}
