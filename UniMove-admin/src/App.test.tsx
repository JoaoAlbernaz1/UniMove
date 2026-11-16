import { StrictMode } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import App from "./App"
import { adminUser, fakeApi, signedInRoutes } from "./test/fakeApi"

const anonymous = { "GET /admin/auth/session": { status: 401, body: {} } }
const refreshDenied = { "POST /admin/auth/refresh": { status: 401, body: {} } }

const navLink = (name: string) =>
  within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name })

/** O segundo fator tem seis casas: digitar na primeira preenche as demais. */
async function typeCode(
  user: ReturnType<typeof userEvent.setup>,
  code: string,
) {
  await user.type(await screen.findByLabelText("Dígito 1 de 6"), code)
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("E-mail institucional"), "ana@ucb.edu.br")
  await user.type(screen.getByLabelText("Senha"), "SenhaForte123!")
  await user.click(screen.getByRole("button", { name: /entrar/i }))
}

describe("autenticação", () => {
  it("sem sessão mostra o login e não renderiza o painel", async () => {
    fakeApi({ ...anonymous, ...refreshDenied })
    render(<App />)
    expect(await screen.findByRole("heading", { name: "Acessar o painel administrativo" })).toBeTruthy()
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("login completo: senha, código, painel; a senha sai do formulário", async () => {
    const user = userEvent.setup()
    const api = fakeApi({
      ...anonymous,
      ...refreshDenied,
      "POST /admin/auth/login": { body: { step: "TWO_FACTOR" } },
      "POST /admin/auth/two-factor": { body: { user: adminUser } },
      "GET /admin/dashboard/summary": signedInRoutes()["GET /admin/dashboard/summary"],
      "GET /admin/dashboard/series": { body: [] },
      "GET /admin/audit-logs": { body: [], headers: { "X-Total-Count": "0" } },
    })
    render(<App />)
    await signIn(user)
    await typeCode(user, "123456")
    await user.click(screen.getByRole("button", { name: /verificar/i }))
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeTruthy()
    expect(screen.getAllByText("Ana Administradora").length).toBeGreaterThan(0)
    expect(api.find("POST", "/admin/auth/login")[0].body).toEqual({
      email: "ana@ucb.edu.br",
      password: "SenhaForte123!",
    })
    expect(api.find("POST", "/admin/auth/two-factor")[0].body).toEqual({ code: "123456" })
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })

  it("credencial errada e conta sem ADMIN mostram o erro da API", async () => {
    const user = userEvent.setup()
    let reply = { status: 401, body: { message: "Credenciais inválidas." } }
    fakeApi({
      ...anonymous,
      ...refreshDenied,
      "POST /admin/auth/login": () => reply,
    })
    render(<App />)
    await signIn(user)
    expect((await screen.findByRole("alert")).textContent).toContain("Credenciais inválidas.")
    reply = {
      status: 403,
      body: { message: "Esta conta não tem acesso ao painel administrativo." },
    }
    await user.click(screen.getByRole("button", { name: /entrar/i }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("não tem acesso"),
    )
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("código errado não entra", async () => {
    const user = userEvent.setup()
    fakeApi({
      ...anonymous,
      ...refreshDenied,
      "POST /admin/auth/login": { body: { step: "TWO_FACTOR" } },
      "POST /admin/auth/two-factor": {
        status: 401,
        body: { message: "Código de autenticação inválido." },
      },
    })
    render(<App />)
    await signIn(user)
    await typeCode(user, "000000")
    await user.click(screen.getByRole("button", { name: /verificar/i }))
    expect((await screen.findByRole("alert")).textContent).toContain("inválido")
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("conta sem autenticador não ganha tela de cadastro: o painel explica e para", async () => {
    const user = userEvent.setup()
    fakeApi({
      ...anonymous,
      ...refreshDenied,
      // O backend provisiona o fator por operador, em terminal privado. Não
      // existe caminho por HTTP, e o painel não pode inventar um.
      "POST /admin/auth/login": {
        status: 403,
        body: {
          code: "ADMIN_ENROLLMENT_REQUIRED",
          message: "O segundo fator administrativo precisa ser provisionado por um operador autorizado.",
        },
      },
    })
    render(<App />)
    await signIn(user)
    expect((await screen.findByRole("alert")).textContent).toContain("operador autorizado")
    expect(screen.queryByAltText(/QR Code/)).toBeNull()
    expect(screen.queryByRole("button", { name: /ativar e entrar/i })).toBeNull()
    expect(screen.queryByRole("navigation")).toBeNull()
    // A conta continua na etapa de credenciais, sem segunda etapa prometida.
    expect(screen.getByRole("heading", { name: /acessar o painel administrativo/i })).toBeTruthy()
  })

  it("códigos de recuperação do segundo fator são exibidos uma vez quando o servidor os envia", async () => {
    const user = userEvent.setup()
    fakeApi({
      ...signedInRoutes(),
      ...anonymous,
      ...refreshDenied,
      "POST /admin/auth/login": { body: { step: "TWO_FACTOR" } },
      "POST /admin/auth/two-factor": {
        body: { user: adminUser, recoveryCodes: ["AAAAA-11111", "BBBBB-22222"] },
      },
    })
    render(<App />)
    await signIn(user)
    await typeCode(user, "123456")
    await user.click(screen.getByRole("button", { name: /verificar/i }))
    expect(await screen.findByText("AAAAA-11111")).toBeTruthy()
    const proceed = screen.getByRole<HTMLButtonElement>("button", { name: /entrar no painel/i })
    expect(proceed.disabled).toBe(true)
    await user.click(screen.getByRole("checkbox"))
    await user.click(proceed)
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeTruthy()
  })

  it("mostrar a senha é opção do usuário, e o campo volta a ser oculto ao seguir", async () => {
    const user = userEvent.setup()
    fakeApi({
      ...anonymous,
      ...refreshDenied,
      "POST /admin/auth/login": { body: { step: "TWO_FACTOR" } },
    })
    render(<App />)
    const field = await screen.findByLabelText<HTMLInputElement>("Senha")
    expect(field.type).toBe("password")
    await user.click(screen.getByRole("button", { name: "Mostrar senha" }))
    expect(field.type).toBe("text")
    await user.type(field, "SenhaForte123!")
    await user.type(screen.getByLabelText("E-mail institucional"), "ana@ucb.edu.br")
    await user.click(screen.getByRole("button", { name: /entrar/i }))
    await screen.findByLabelText("Dígito 1 de 6")
    expect(screen.queryByDisplayValue("SenhaForte123!")).toBeNull()
  })

  it("segundo fator permite voltar e usar outra conta sem recarregar", async () => {
    const user = userEvent.setup()
    fakeApi({
      ...anonymous,
      ...refreshDenied,
      "POST /admin/auth/login": { body: { step: "TWO_FACTOR" } },
    })
    render(<App />)
    await signIn(user)
    await screen.findByLabelText("Dígito 1 de 6")
    await user.click(screen.getByRole("button", { name: /voltar/i }))
    expect(screen.getByRole("heading", { name: "Acessar o painel administrativo" })).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>("Senha").value).toBe("")
  })

  it("logout chama o backend e volta ao login", async () => {
    const user = userEvent.setup()
    const api = fakeApi(signedInRoutes())
    render(<App />)
    await user.click(await screen.findByRole("button", { name: "Menu da conta" }))
    await user.click(screen.getByRole("button", { name: /sair do painel/i }))
    expect(await screen.findByRole("heading", { name: "Acessar o painel administrativo" })).toBeTruthy()
    expect(api.find("POST", "/admin/auth/logout")).toHaveLength(1)
  })

  it("sessão expirada no meio do uso leva ao login com aviso", async () => {
    const user = userEvent.setup()
    const routes = signedInRoutes()
    fakeApi({ ...routes, ...refreshDenied })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    routes["GET /admin/users"] = { status: 401, body: {} }
    fakeApi({ ...routes, ...refreshDenied })
    await user.click(navLink("Usuários"))
    expect(await screen.findByRole("heading", { name: "Acessar o painel administrativo" })).toBeTruthy()
    expect(screen.getByRole("status").textContent).toContain("sessão expirou")
  })

  it("vários 401 simultâneos mantêm o aviso de sessão expirada, inclusive em StrictMode", async () => {
    const user = userEvent.setup()
    window.history.pushState(null, "", "/usuarios")
    const routes = signedInRoutes()
    fakeApi({ ...routes, ...refreshDenied })
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findByRole("heading", { name: "Gestão de usuários" })
    const expired = { status: 401, body: {} }
    fakeApi({
      ...routes,
      ...refreshDenied,
      "GET /admin/dashboard/summary": expired,
      "GET /admin/dashboard/series": expired,
      "GET /admin/audit-logs": expired,
    })
    await user.click(navLink("Visão geral"))
    expect(await screen.findByRole("heading", { name: "Acessar o painel administrativo" })).toBeTruthy()
    expect((await screen.findByRole("status")).textContent).toContain("sessão expirou")
  })

  it("conta sem autorização vê acesso negado, nunca o painel", async () => {
    fakeApi({
      "GET /admin/auth/session": {
        status: 403,
        body: { code: "ADMIN_2FA_REQUIRED", message: "Ative o segundo fator." },
      },
    })
    render(<App />)
    expect(await screen.findByRole("heading", { name: "Acesso não autorizado" })).toBeTruthy()
    expect(screen.getByText("Ative o segundo fator.")).toBeTruthy()
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("role revogada no meio do uso tira o usuário do painel", async () => {
    const user = userEvent.setup()
    const routes = signedInRoutes()
    fakeApi(routes)
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    routes["GET /admin/users"] = {
      status: 403,
      body: { code: "HTTP_403", message: "Perfil sem permissão para esta operação." },
    }
    fakeApi(routes)
    await user.click(navLink("Usuários"))
    expect(await screen.findByRole("heading", { name: "Acesso não autorizado" })).toBeTruthy()
  })

  it("API sem as rotas do painel explica a publicação e não mostra texto técnico", async () => {
    fakeApi({
      "GET /admin/auth/session": {
        status: 404,
        body: { code: "HTTP_404", message: "Cannot GET /api/v1/admin/auth/session" },
      },
    })
    render(<App />)
    expect(
      await screen.findByRole("heading", { name: "API do painel ainda não publicada" }),
    ).toBeTruthy()
    expect(document.body.textContent).not.toContain("Cannot GET")
    expect(screen.queryByLabelText("Senha")).toBeNull()
  })

  it("API fora do ar não vira login: oferece tentar de novo", async () => {
    fakeApi({ "GET /admin/auth/session": { status: 503 } })
    render(<App />)
    expect(await screen.findByRole("heading", { name: "Servidor indisponível" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /tentar novamente/i })).toBeTruthy()
  })
})

describe("navegação e estados", () => {
  const pages: [string, string][] = [
    ["Usuários", "Gestão de usuários"],
    ["Verificações", "Verificações acadêmicas"],
    ["Caronas", "Gestão de caronas"],
    ["Moderação", "Central de moderação"],
    ["Auditoria", "Auditoria"],
  ]

  it.each(pages)("%s abre, muda a URL e trata lista vazia", async (button, heading) => {
    const user = userEvent.setup()
    fakeApi(signedInRoutes())
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    const nav = screen.getByRole("navigation", { name: "Principal" })
    await user.click(within(nav).getByRole("link", { name: button }))
    expect(await screen.findByRole("heading", { name: heading, level: 1 })).toBeTruthy()
    expect(window.location.pathname).not.toBe("/")
    expect(await screen.findByText(/nenhum/i)).toBeTruthy()
  })

  it("abre direto pela URL da página", async () => {
    window.history.pushState(null, "", "/caronas")
    fakeApi(signedInRoutes())
    render(<App />)
    expect(await screen.findByRole("heading", { name: "Gestão de caronas" })).toBeTruthy()
  })

  it("dashboard vazio não inventa número nem crescimento", async () => {
    fakeApi(signedInRoutes())
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    expect(await screen.findByText("Sem caronas no período")).toBeTruthy()
    expect(screen.getByText("Sem cadastros no período")).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\+\d+,\d%/)
    expect(document.body.textContent).not.toMatch(/demonstrativ/i)
  })

  it("erro da API mostra a mensagem e permite repetir", async () => {
    const user = userEvent.setup()
    window.history.pushState(null, "", "/usuarios")
    const routes = signedInRoutes()
    let fail = true
    routes["GET /admin/users"] = () =>
      fail
        ? { status: 500, body: { message: "Erro interno do servidor." } }
        : { body: [], headers: { "X-Total-Count": "0" } }
    fakeApi(routes)
    render(<App />)
    expect((await screen.findByRole("alert")).textContent).toContain("Erro interno")
    fail = false
    await user.click(screen.getByRole("button", { name: /tentar novamente/i }))
    expect(await screen.findByText("Nenhum resultado encontrado")).toBeTruthy()
  })
})
