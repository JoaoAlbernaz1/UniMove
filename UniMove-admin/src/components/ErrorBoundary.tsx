import { Component, type ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

/**
 * Sem isto, um erro de renderização deixa a tela em branco. O caso mais comum é um
 * deploy novo: a aba aberta pede um arquivo de página que não existe mais.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="state-block" role="alert">
        <div className="state-icon state-icon-error">
          <AlertTriangle size={20} />
        </div>
        <strong>Não foi possível abrir esta tela</strong>
        <p>O painel pode ter sido atualizado. Recarregue a página para continuar.</p>
        <button
          type="button"
          className="button button-secondary state-action"
          onClick={() => window.location.reload()}
        >
          <RefreshCw size={14} /> Recarregar página
        </button>
      </div>
    )
  }
}
