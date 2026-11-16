import { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { ConfirmModal, Modal } from "./ui"

function ModalExample({ removeOpener = false }: { removeOpener?: boolean }) {
  const [open, setOpen] = useState(false)
  const [nested, setNested] = useState(false)
  const [completed, setCompleted] = useState(false)
  return (
    <main id="main-content" tabIndex={-1}>
      {(!removeOpener || !completed) && <button onClick={() => setOpen(true)}>Abrir detalhes</button>}
      {open && (
        <Modal title="Detalhes" onClose={() => setOpen(false)}>
          <button onClick={() => setNested(true)}>Abrir confirmação</button>
          <input aria-label="Anotação" />
          {nested && (
            <Modal title="Confirmação" onClose={() => setNested(false)}>
              <button onClick={() => setNested(false)}>Voltar</button>
              <button onClick={() => { setNested(false); setOpen(false); setCompleted(true) }}>Concluir decisão</button>
            </Modal>
          )}
        </Modal>
      )}
    </main>
  )
}

describe("acesso aos modais pelo teclado", () => {
  it("mantém Tab no diálogo e devolve o foco ao botão que o abriu", async () => {
    const user = userEvent.setup()
    const view = render(<ModalExample />)
    const opener = screen.getByRole("button", { name: "Abrir detalhes" })
    await user.click(opener)
    const dialog = screen.getByRole("dialog", { name: "Detalhes" })
    expect(view.container.hasAttribute("inert")).toBe(true)
    const input = within(dialog).getByRole("textbox")
    input.focus()
    await user.tab()
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Fechar" }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(input)
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(view.container.hasAttribute("inert")).toBe(false)
  })

  it("Escape fecha só a confirmação superior e restaura o diálogo anterior", async () => {
    const user = userEvent.setup()
    render(<ModalExample />)
    await user.click(screen.getByRole("button", { name: "Abrir detalhes" }))
    const opener = screen.getByRole("button", { name: "Abrir confirmação" })
    await user.click(opener)
    expect(screen.getByRole("dialog", { name: "Confirmação" })).toBeTruthy()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog", { name: "Confirmação" })).toBeNull()
    expect(screen.getByRole("dialog", { name: "Detalhes" })).toBeTruthy()
    expect(document.activeElement).toBe(opener)
  })

  it("não descarta uma decisão enquanto a API está processando", async () => {
    const user = userEvent.setup()
    render(
      <ConfirmModal
        title="Confirmar decisão"
        description="Aguarde a resposta."
        confirmLabel="Confirmar"
        onClose={() => { throw new Error("Fechamento durante o processamento") }}
        onConfirm={() => new Promise(() => {})}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Confirmar" }))
    await user.keyboard("{Escape}")
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Fechar" }).disabled).toBe(true)
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("clique fora não descarta o motivo digitado, e o foco começa no campo", async () => {
    const user = userEvent.setup()
    let closed = false
    render(
      <ConfirmModal
        title="Suspender"
        description="Descrição"
        confirmLabel="Confirmar"
        requireReason
        onClose={() => { closed = true }}
        onConfirm={() => Promise.resolve()}
      />,
    )
    const field = screen.getByLabelText("Motivo obrigatório")
    expect(document.activeElement).toBe(field)
    await user.type(field, "Conduta")
    await user.click(document.querySelector(".modal-backdrop")!)
    expect(closed).toBe(false)
    expect(screen.getByLabelText<HTMLTextAreaElement>("Motivo obrigatório").value).toBe("Conduta")
  })

  it("aviso flutuante não fica inerte com um diálogo aberto", async () => {
    const user = userEvent.setup()
    const region = document.createElement("div")
    region.setAttribute("data-modal-exempt", "")
    document.body.append(region)
    render(<ModalExample />)
    await user.click(screen.getByRole("button", { name: "Abrir detalhes" }))
    expect(region.hasAttribute("inert")).toBe(false)
    region.remove()
  })

  it("restaura o foco original quando a decisão fecha as duas camadas juntas", async () => {
    const user = userEvent.setup()
    render(<ModalExample />)
    const opener = screen.getByRole("button", { name: "Abrir detalhes" })
    await user.click(opener)
    await user.click(screen.getByRole("button", { name: "Abrir confirmação" }))
    await user.click(screen.getByRole("button", { name: "Concluir decisão" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe("")
  })

  it("foca o conteúdo quando a decisão remove a linha que abriu o diálogo", async () => {
    const user = userEvent.setup()
    render(<ModalExample removeOpener />)
    await user.click(screen.getByRole("button", { name: "Abrir detalhes" }))
    await user.click(screen.getByRole("button", { name: "Abrir confirmação" }))
    await user.click(screen.getByRole("button", { name: "Concluir decisão" }))
    expect(document.activeElement).toBe(screen.getByRole("main"))
  })
})
