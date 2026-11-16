import { useState } from "react"
import { Copy, Download } from "lucide-react"
import { Button } from "./ui"
import { AlertBanner } from "./fields"

/**
 * Os oito códigos de recuperação, exibidos na única vez em que existem em
 * claro. Não há rota para consultá-los depois: o servidor guarda apenas hashes.
 * Por isso a tela oferece copiar e salvar aqui, e exige a confirmação explícita
 * de que foram guardados antes de seguir.
 */
export function RecoveryCodes({
  codes,
  onContinue,
  continueLabel = "Concluir",
  requireConfirmation = true,
}: {
  codes: string[]
  onContinue?: () => void
  continueLabel?: string
  requireConfirmation?: boolean
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState<string>()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"))
      setNotice("Códigos copiados para a área de transferência.")
    } catch {
      // Navegador pode bloquear a área de transferência sem gesto confiável.
      setNotice("O navegador bloqueou a cópia. Selecione os códigos e copie à mão.")
    }
  }

  const download = () => {
    const content = [
      "UniCarona Admin — códigos de recuperação",
      "Cada código vale uma única vez. Guarde este arquivo em local seguro.",
      "",
      ...codes,
      "",
      `Emitidos em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    ].join("\n")
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    )
    const link = document.createElement("a")
    link.href = url
    link.download = "unicarona-admin-codigos-de-recuperacao.txt"
    link.click()
    URL.revokeObjectURL(url)
    setNotice("Arquivo salvo com os códigos.")
  }

  return (
    <>
      <AlertBanner tone="warning" title="Exibição única">
        Estes códigos aparecem somente agora. Cada um vale uma única vez, para
        quando você perder o acesso ao aplicativo autenticador. Não há como
        consultá-los depois.
      </AlertBanner>

      <div className="recovery-codes-grid" aria-label={`${codes.length} códigos de recuperação`}>
        {codes.map((code, index) => (
          <div key={code} className="recovery-code-item">
            <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <strong className="mono">{code}</strong>
          </div>
        ))}
      </div>

      <div className="recovery-utility-bar">
        <Button variant="secondary" onClick={() => void copy()}>
          <Copy size={15} aria-hidden="true" /> Copiar códigos
        </Button>
        <Button variant="secondary" onClick={download}>
          <Download size={15} aria-hidden="true" /> Salvar em arquivo
        </Button>
      </div>
      {notice && (
        <p className="field-hint" role="status">
          {notice}
        </p>
      )}

      {requireConfirmation && (
        <>
          <label className="checkbox-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              Confirmo que copiei ou salvei estes códigos em um local seguro.
            </span>
          </label>
        </>
      )}

      {onContinue && (
        <div className="auth-actions">
          {/* Desabilitado até a confirmação: estes códigos não voltam. */}
          <Button onClick={onContinue} disabled={requireConfirmation && !confirmed}>
            {continueLabel}
          </Button>
        </div>
      )}
    </>
  )
}
