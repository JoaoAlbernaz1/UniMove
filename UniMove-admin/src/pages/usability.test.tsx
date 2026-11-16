import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import App from "../App"
import { fakeApi, signedInRoutes } from "../test/fakeApi"

afterEach(() => window.localStorage.clear())

describe("preferências de interface", () => {
  it("aplica tamanho do texto, densidade e menu, preservando ao reabrir o painel", async () => {
    window.history.pushState(null, "", "/configuracoes")
    fakeApi(signedInRoutes())
    const user = userEvent.setup()
    render(<App />)
    const size = await screen.findByRole("combobox", { name: "Tamanho do texto" })
    await user.selectOptions(size, "large")
    await user.click(screen.getByRole("switch", { name: "Tabelas compactas" }))
    await user.click(screen.getByRole("switch", { name: "Recolher menu lateral" }))
    const shell = document.querySelector(".app-shell")!
    expect(shell.getAttribute("data-text-size")).toBe("large")
    expect(shell.getAttribute("data-density")).toBe("compact")
    expect(shell.classList.contains("sidebar-collapsed")).toBe(true)
    cleanup()
    render(<App />)
    await screen.findByRole("heading", { name: "Preferências de interface" })
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Tamanho do texto" }).value).toBe("large")
    expect(screen.getByRole<HTMLInputElement>("switch", { name: "Tabelas compactas" }).checked).toBe(true)
    await user.click(screen.getByRole("button", { name: "Restaurar preferências" }))
    expect(document.querySelector(".app-shell")!.getAttribute("data-text-size")).toBe("standard")
    expect(document.querySelector(".sidebar-collapsed")).toBeNull()
  })

  it("continua utilizável quando o navegador bloqueia o armazenamento", async () => {
    window.history.pushState(null, "", "/configuracoes")
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    fakeApi(signedInRoutes())
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("switch", { name: "Tabelas compactas" }))
    expect(document.querySelector(".app-shell")!.getAttribute("data-density")).toBe("compact")
    expect(await screen.findByRole("status")).toHaveProperty("textContent", expect.stringContaining("nesta sessão"))
  })

  it("ignora preferências inválidas sem impedir o acesso", async () => {
    window.localStorage.setItem("unicarona-admin:preferences:v1", '{"textSize":"tiny","compactTables":"yes","sidebarCollapsed":true}')
    window.history.pushState(null, "", "/configuracoes")
    fakeApi(signedInRoutes())
    render(<App />)
    expect((await screen.findByRole<HTMLSelectElement>("combobox", { name: "Tamanho do texto" })).value).toBe("standard")
    expect(screen.getByRole<HTMLInputElement>("switch", { name: "Tabelas compactas" }).checked).toBe(false)
  })
})

describe.each([
  ["/auditoria", "/admin/audit-logs"],
  ["/caronas", "/admin/rides"],
])("filtro por datas em %s", (path, endpoint) => {
  it("envia dias completos no horário de Brasília e permite limpar o período", async () => {
    window.history.pushState(null, "", path)
    const api = fakeApi(signedInRoutes())
    const user = userEvent.setup()
    render(<App />)
    const form = await screen.findByRole("form", { name: "Filtrar por período" })
    await user.type(within(form).getByLabelText("Data inicial"), "2026-11-01")
    await user.type(within(form).getByLabelText("Data final"), "2026-11-04")
    await user.click(within(form).getByRole("button", { name: "Aplicar período" }))
    await waitFor(() => {
      const call = api.find("GET", endpoint).at(-1)!
      expect(call.search.get("from")).toBe("2026-11-01T03:00:00.000Z")
      expect(call.search.get("to")).toBe("2026-11-05T02:59:59.999Z")
      expect(call.search.get("page")).toBe("1")
    })
    await user.click(within(form).getByRole("button", { name: "Limpar período" }))
    await waitFor(() => expect(api.find("GET", endpoint).at(-1)!.search.has("from")).toBe(false))
  })

  it("explica um intervalo invertido sem enviá-lo à API", async () => {
    window.history.pushState(null, "", path)
    const api = fakeApi(signedInRoutes())
    const user = userEvent.setup()
    render(<App />)
    const form = await screen.findByRole("form", { name: "Filtrar por período" })
    await user.type(within(form).getByLabelText("Data inicial"), "2026-11-04")
    await user.type(within(form).getByLabelText("Data final"), "2026-11-01")
    await user.click(within(form).getByRole("button", { name: "Aplicar período" }))
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("data final"))
    expect(api.find("GET", endpoint).some((call) => call.search.has("from"))).toBe(false)
  })
})

describe("filtros na URL", () => {
  const userRow = {
    id: "22222222-2222-4222-8222-222222222222",
    fullName: "Marina Oliveira",
    institutionalEmail: "marina@ucb.edu.br",
    course: "Direito",
    status: "ACTIVE",
    createdAt: "2026-10-01T12:00:00.000Z",
    deletedAt: null,
    roles: ["PASSENGER"],
    verificationStatus: "APPROVED",
  }
  function userRoutes() {
    const routes = signedInRoutes()
    routes["GET /admin/users"] = { body: [userRow], headers: { "X-Total-Count": "41" } }
    return routes
  }

  it("recarregar a página mantém filtros e página na lista", async () => {
    window.history.pushState(null, "", "/usuarios?status=SUSPENDED&q=marina&page=2")
    const api = fakeApi(userRoutes())
    render(<App />)
    await screen.findByText("Marina Oliveira")
    const call = api.find("GET", "/admin/users").at(-1)!
    expect(call.search.get("status")).toBe("SUSPENDED")
    expect(call.search.get("q")).toBe("marina")
    expect(call.search.get("page")).toBe("2")
    expect(screen.getByLabelText<HTMLSelectElement>("Filtrar situação").value).toBe("SUSPENDED")
    expect(screen.getByLabelText<HTMLInputElement>(/buscar por nome/i).value).toBe("marina")
    expect(screen.getByText("Página 2 de 3")).toBeTruthy()
  })

  it("valor desconhecido na URL é ignorado em vez de virar erro", async () => {
    window.history.pushState(null, "", "/usuarios?status=INVENTADO&page=abc")
    const api = fakeApi(userRoutes())
    render(<App />)
    await screen.findByText("Marina Oliveira")
    const call = api.find("GET", "/admin/users").at(-1)!
    expect(call.search.has("status")).toBe(false)
    expect(call.search.get("page")).toBe("1")
  })

  it("trocar um filtro volta à primeira página sem pedido a mais com a página antiga", async () => {
    window.history.pushState(null, "", "/usuarios?page=3")
    const user = userEvent.setup()
    const api = fakeApi(userRoutes())
    render(<App />)
    await screen.findByText("Marina Oliveira")
    const before = api.find("GET", "/admin/users").length
    await user.selectOptions(screen.getByLabelText("Filtrar perfil"), "DRIVER")
    await waitFor(() => expect(api.find("GET", "/admin/users").length).toBe(before + 1))
    const call = api.find("GET", "/admin/users").at(-1)!
    expect(call.search.get("role")).toBe("DRIVER")
    expect(call.search.get("page")).toBe("1")
    expect(window.location.search).toBe("?role=DRIVER")
  })

  it("resultado vazio com filtro oferece limpar, e lista vazia sem filtro não", async () => {
    window.history.pushState(null, "", "/usuarios?status=BLOCKED")
    const user = userEvent.setup()
    fakeApi(signedInRoutes())
    render(<App />)
    const clear = await screen.findAllByRole("button", { name: "Limpar filtros" })
    await user.click(clear[clear.length - 1])
    expect(window.location.search).toBe("")
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Limpar filtros" })).toBeNull(),
    )
    expect(screen.getByText("Nenhum resultado encontrado")).toBeTruthy()
  })

  it("contagem por status em caronas filtra a lista e marca a opção escolhida", async () => {
    window.history.pushState(null, "", "/caronas")
    const user = userEvent.setup()
    const routes = signedInRoutes()
    routes["GET /admin/rides"] = {
      body: [],
      headers: { "X-Total-Count": "0", "X-Status-Counts": '{"CANCELLED":4}' },
    }
    const api = fakeApi(routes)
    render(<App />)
    const group = await screen.findByRole("group", { name: "Filtrar por status" })
    const option = await within(group).findByRole("button", { name: /Canceladas\s*4/ })
    await user.click(option)
    await waitFor(() =>
      expect(api.find("GET", "/admin/rides").at(-1)!.search.get("status")).toBe("CANCELLED"),
    )
    expect(option.getAttribute("aria-pressed")).toBe("true")
  })

  it("aba de verificações pela URL, e a pendente não polui o endereço", async () => {
    window.history.pushState(null, "", "/verificacoes?status=REJECTED")
    const user = userEvent.setup()
    const api = fakeApi(signedInRoutes())
    render(<App />)
    expect(await screen.findByText("Nenhuma solicitação rejeitada")).toBeTruthy()
    expect(
      screen.getByRole("tab", { name: /Rejeitadas/ }).getAttribute("aria-selected"),
    ).toBe("true")
    await user.click(screen.getByRole("tab", { name: /Pendentes/ }))
    expect(window.location.search).toBe("")
    await waitFor(() =>
      expect(
        api.find("GET", "/admin/academic-verifications").at(-1)!.search.get("status"),
      ).toBe("PENDING_REVIEW"),
    )
  })
})

describe("restrição de conta", () => {
  it("com carona em andamento, explica e não deixa confirmar", async () => {
    const id = "22222222-2222-4222-8222-222222222222"
    window.history.pushState(null, "", "/usuarios")
    const user = userEvent.setup()
    const routes = signedInRoutes()
    const row = {
      id,
      fullName: "Marina Oliveira",
      institutionalEmail: "marina@ucb.edu.br",
      course: null,
      status: "ACTIVE",
      createdAt: "2026-10-01T12:00:00.000Z",
      deletedAt: null,
      roles: ["DRIVER"],
      verificationStatus: null,
    }
    routes["GET /admin/users"] = { body: [row], headers: { "X-Total-Count": "1" } }
    routes[`GET /admin/users/${id}`] = {
      body: {
        ...row,
        studentNumber: null,
        semester: null,
        profileCompletedAt: null,
        academicVerification: null,
        vehicles: [],
        counts: { drivenRides: 1, reservations: 0, incidentsReported: 0, incidentsAgainst: 0 },
        rating: { average: null, count: 0 },
        adminHistory: [],
      },
    }
    routes[`GET /admin/users/${id}/impact`] = {
      body: {
        ridesInProgress: 1,
        futureRidesAsDriver: 0,
        passengersAffected: 0,
        reservationsAsPassenger: 0,
        pendingRequestsAsPassenger: 0,
      },
    }
    fakeApi(routes)
    render(<App />)
    await user.click(await screen.findByRole("button", { name: "Ver Marina Oliveira" }))
    await user.click(await screen.findByRole("button", { name: "Suspender conta" }))
    expect(await screen.findByText(/carona em andamento/)).toBeTruthy()
    await user.type(screen.getByLabelText("Motivo obrigatório"), "Conduta em análise")
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Confirmar suspensão" }).disabled,
    ).toBe(true)
  })
})

describe("visão geral", () => {
  it("usa o resumo do layout, sem pedir os mesmos números duas vezes", async () => {
    const api = fakeApi(signedInRoutes())
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await screen.findByText("Sem caronas no período")
    expect(api.find("GET", "/admin/dashboard/summary")).toHaveLength(1)
  })

  it("período entra na URL e só pede de novo a série, não os indicadores", async () => {
    const user = userEvent.setup()
    const api = fakeApi(signedInRoutes())
    render(<App />)
    await user.click(await screen.findByRole("button", { name: "30 dias" }))
    expect(window.location.search).toBe("?dias=30")
    await waitFor(() =>
      expect(api.find("GET", "/admin/dashboard/series").at(-1)!.search.get("days")).toBe("30"),
    )
    expect(api.find("GET", "/admin/dashboard/summary")).toHaveLength(1)
  })
})
