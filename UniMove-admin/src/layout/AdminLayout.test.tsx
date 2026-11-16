import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import App from "../App"
import { emptySummary, fakeApi, signedInRoutes } from "../test/fakeApi"

const mainNav = () => screen.getByRole("navigation", { name: "Principal" })

async function openPanel(path = "/usuarios") {
  window.history.pushState(null, "", path)
  fakeApi(signedInRoutes())
  render(<App />)
  await screen.findByRole("navigation", { name: "Principal" })
}

describe("navegação", () => {
  it("menu usa links reais, marca a página atual e soma pendências no nome", async () => {
    window.history.pushState(null, "", "/usuarios")
    const routes = signedInRoutes()
    routes["GET /admin/dashboard/summary"] = {
      body: { ...emptySummary, verifications: { pending: 12, pendingOver24h: 3 } },
    }
    fakeApi(routes)
    render(<App />)
    const link = await within(await screen.findByRole("navigation", { name: "Principal" }))
      .findByRole<HTMLAnchorElement>("link", { name: /Verificações.*12 pendentes/ })
    expect(link.getAttribute("href")).toBe("/verificacoes")
    expect(
      within(mainNav()).getByRole("link", { name: "Usuários" }).getAttribute("aria-current"),
    ).toBe("page")
    expect(screen.getByRole("button", { name: "Pendências: 12" })).toBeTruthy()
  })

  it("Ctrl+clique fica com o navegador e não troca a tela", async () => {
    await openPanel()
    const link = within(mainNav()).getByRole("link", { name: "Caronas" })
    fireEvent.click(link, { ctrlKey: true })
    expect(window.location.pathname).toBe("/usuarios")
  })

  it("trocar de tela atualiza o título da aba, a trilha e move o foco para o conteúdo", async () => {
    const user = userEvent.setup()
    await openPanel()
    expect(document.title).toContain("Usuários")
    await user.click(within(mainNav()).getByRole("link", { name: "Caronas" }))
    await screen.findByRole("heading", { name: "Gestão de caronas" })
    expect(document.title).toContain("Caronas")
    expect(document.activeElement).toBe(screen.getByRole("main"))
    const trail = screen.getByRole("navigation", { name: "Trilha de navegação" })
    expect(within(trail).getByRole("link", { name: "Visão geral" })).toBeTruthy()
    expect(within(trail).getByText("Caronas").getAttribute("aria-current")).toBe("page")
  })

  it("busca do topo leva a usuários e a tecla / chega até ela", async () => {
    const user = userEvent.setup()
    await openPanel("/caronas")
    const field = screen.getByRole("searchbox", { name: "Buscar usuários" })
    await user.keyboard("/")
    expect(document.activeElement).toBe(field)
    await user.keyboard("marina{Enter}")
    expect(window.location.pathname).toBe("/usuarios")
    expect(window.location.search).toBe("?q=marina")
  })

  it("a tecla / não rouba o que se digita em outro campo", async () => {
    const user = userEvent.setup()
    await openPanel()
    const local = await screen.findByLabelText(/buscar por nome/i)
    await user.click(local)
    await user.keyboard("a/b")
    expect((local as HTMLInputElement).value).toBe("a/b")
  })
})

describe("popovers e gaveta", () => {
  it("Esc fecha o menu da conta e devolve o foco ao botão", async () => {
    const user = userEvent.setup()
    await openPanel()
    const button = screen.getByRole("button", { name: "Menu da conta" })
    await user.click(button)
    expect(button.getAttribute("aria-expanded")).toBe("true")
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("button", { name: /sair do painel/i })).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it("clique fora fecha, e abrir um popover fecha o outro", async () => {
    const user = userEvent.setup()
    await openPanel()
    await user.click(screen.getByRole("button", { name: "Menu da conta" }))
    await user.click(screen.getByRole("button", { name: "Pendências" }))
    expect(screen.queryByRole("button", { name: /sair do painel/i })).toBeNull()
    expect(screen.getByText("Aguardando revisão")).toBeTruthy()
    await user.click(screen.getByRole("main"))
    expect(screen.queryByText("Aguardando revisão")).toBeNull()
  })

  it("gaveta do celular leva o foco para o menu e Esc o devolve ao botão", async () => {
    const user = userEvent.setup()
    await openPanel()
    const open = screen.getByRole("button", { name: "Abrir menu" })
    await user.click(open)
    expect(document.activeElement).toBe(within(mainNav()).getAllByRole("link")[0])
    expect(document.querySelector(".main-column")!.hasAttribute("inert")).toBe(true)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(document.activeElement).toBe(open))
    expect(document.querySelector(".main-column")!.hasAttribute("inert")).toBe(false)
  })
})

describe("avisos", () => {
  it("erro de exportação fica até ser fechado e é anunciado como alerta", async () => {
    const user = userEvent.setup()
    window.history.pushState(null, "", "/relatorios")
    const routes = signedInRoutes()
    routes["GET /admin/reports/summary"] = {
      body: {
        days: 30,
        completionRate: null,
        cancellationRate: null,
        requestAcceptanceRate: null,
        estimatedValueCents: 0,
        topOrigins: [],
        verifications: {},
        incidentsByType: {},
        series: [],
      },
    }
    routes["GET /admin/reports/users/export"] = {
      status: 500,
      body: { message: "Falha ao gerar o arquivo." },
    }
    fakeApi(routes)
    render(<App />)
    await user.click(await screen.findByRole("button", { name: "Usuários" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Falha ao gerar")
    await user.click(screen.getByRole("button", { name: "Fechar aviso" }))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
