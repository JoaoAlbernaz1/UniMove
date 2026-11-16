import { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DataTable, ListView, type Column } from "./DataTable"
import { TabPanel, Tabs } from "./Tabs"
import { ReasonField } from "./ui"

function Example() {
  const [tab, setTab] = useState("a")
  return (
    <>
      <Tabs
        label="Exemplo"
        panelId="painel"
        value={tab}
        onChange={setTab}
        items={[
          { id: "a", label: "Primeira" },
          { id: "b", label: "Indisponível", disabled: true },
          { id: "c", label: "Terceira" },
        ]}
      />
      <TabPanel panelId="painel" active={tab}>
        Conteúdo {tab}
      </TabPanel>
    </>
  )
}

describe("abas", () => {
  it("setas pulam a aba desativada, dão a volta e levam o foco junto", async () => {
    const user = userEvent.setup()
    render(<Example />)
    screen.getByRole("tab", { name: "Primeira" }).focus()
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Terceira" }))
    expect(screen.getByRole("tabpanel").textContent).toBe("Conteúdo c")
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Primeira" }))
    await user.keyboard("{End}")
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Terceira" }))
    await user.keyboard("{Home}")
    expect(screen.getByRole("tabpanel").textContent).toBe("Conteúdo a")
  })

  it("só a aba ativa fica na ordem de Tab e o painel aponta para ela", () => {
    render(<Example />)
    const active = screen.getByRole("tab", { name: "Primeira" })
    expect(active.tabIndex).toBe(0)
    expect(screen.getByRole("tab", { name: "Terceira" }).tabIndex).toBe(-1)
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(active.id)
  })
})

type Row = { id: string; name: string; course: string }
const columns: Column<Row>[] = [
  { key: "name", header: "Nome", primary: true, cell: (row) => row.name },
  { key: "course", header: "Curso", wrap: true, cell: (row) => row.course },
  { key: "open", header: "Ações", action: true, cell: () => <button>Abrir</button> },
]
const rowKey = (row: Row) => row.id
const pessoa = { id: "1", name: "Ana", course: "Ciência da Computação" }

describe("tabela", () => {
  it("rotula a rolagem, os cabeçalhos e as células para o modo em blocos", () => {
    render(<DataTable label="Pessoas" columns={columns} rows={[pessoa]} rowKey={rowKey} />)
    const region = screen.getByRole("region", { name: "Pessoas" })
    expect(region.tabIndex).toBe(0)
    expect(within(region).getByRole("columnheader", { name: "Ações" })).toBeTruthy()
    expect(within(region).getAllByRole("cell")[2].getAttribute("data-label")).toBe("Ações")
  })

  // Sem rótulo em toda célula o bloco perde o nome do campo, porque o cabeçalho sai da vista.
  it("toda célula leva o rótulo da coluna, inclusive a de ação", () => {
    render(<DataTable label="Pessoas" columns={columns} rows={[pessoa]} rowKey={rowKey} />)
    const rotulos = screen.getAllByRole("cell").map((cell) => cell.getAttribute("data-label"))
    expect(rotulos).toEqual(["Nome", "Curso", "Ações"])
  })

  it("coluna de texto longo recebe a classe que deixa a tabela caber", () => {
    render(<DataTable label="Pessoas" columns={columns} rows={[pessoa]} rowKey={rowKey} />)
    const [nome, curso] = screen.getAllByRole("cell")
    expect(curso.classList.contains("cell-wrap")).toBe(true)
    expect(nome.classList.contains("cell-wrap")).toBe(false)
  })

  it("página que ficou vazia volta para a última que existe", () => {
    const onPageChange = vi.fn()
    render(
      <ListView
        query={{ data: { items: [], total: 41, statusCounts: {} }, loading: false, reload: () => {} }}
        label="Pessoas"
        columns={columns}
        rowKey={rowKey}
        empty={<p>Vazio</p>}
        page={5}
        onPageChange={onPageChange}
        countLabel={(total) => `${total} pessoas`}
      />,
    )
    expect(onPageChange).toHaveBeenCalledWith(3)
    expect(screen.queryByText("Vazio")).toBeNull()
  })

  it("lista realmente vazia não pede outra página", () => {
    const onPageChange = vi.fn()
    render(
      <ListView
        query={{ data: { items: [], total: 0, statusCounts: {} }, loading: false, reload: () => {} }}
        label="Pessoas"
        columns={columns}
        rowKey={rowKey}
        empty={<p>Vazio</p>}
        page={1}
        onPageChange={onPageChange}
        countLabel={(total) => `${total} pessoas`}
      />,
    )
    expect(onPageChange).not.toHaveBeenCalled()
    expect(screen.getByText("Vazio")).toBeTruthy()
  })
})

describe("campo de justificativa", () => {
  it("explica o mínimo que ainda falta e conta os caracteres", () => {
    const { rerender } = render(
      <ReasonField label="Motivo" value="abc" onChange={() => {}} minLength={5} maxLength={500} />,
    )
    const field = screen.getByLabelText<HTMLTextAreaElement>("Motivo")
    const hint = document.getElementById(field.getAttribute("aria-describedby")!)!
    expect(hint.textContent).toContain("Mínimo de 5 caracteres.")
    expect(hint.textContent).toContain("3 de 500")
    rerender(<ReasonField label="Motivo" value="abcdef" onChange={() => {}} minLength={5} maxLength={500} />)
    expect(hint.textContent).not.toContain("Mínimo")
  })
})
