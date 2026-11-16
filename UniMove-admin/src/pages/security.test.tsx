import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import App from "../App"
import { adminUser, fakeApi, signedInRoutes } from "../test/fakeApi"

/**
 * As telas de acesso e segurança contra uma API de mentira no nível do fetch:
 * o código real de `http.ts` roda inteiro, com cookie, CSRF e renovação.
 *
 * Nenhum dado de demonstração entra aqui. Toda informação que aparece na tela
 * vem das respostas simuladas, e o que a API não devolve é afirmado como
 * ausente, não como um valor inventado.
 */

const overview = {
  account: {
    id: adminUser.id,
    fullName: "Ana Administradora",
    email: "ana@ucb.edu.br",
    status: "ACTIVE",
    roles: ["ADMIN"],
    permissions: ["MANAGE_ADMINS", "VIEW_AUDIT"],
    permissionsUpdatedAt: "2026-11-01T12:00:00.000Z",
    createdAt: "2026-01-10T12:00:00.000Z",
  },
  twoFactor: {
    enabled: true,
    recoveryCodesRemaining: 6,
    recoveryCodesTotal: 8,
    issuer: "UniCarona Admin",
    boundAt: "2026-02-12T09:10:00.000Z",
  },
  password: { changedAt: null },
  sessions: {
    active: 2,
    others: 1,
    currentStartedAt: "2026-11-07T08:30:00.000Z",
    currentUserAgent: "Mozilla/5.0 (Macintosh) Chrome/131.0",
  },
  lastLoginAt: "2026-11-07T08:30:00.000Z",
  sessionMaxHours: 12,
}

const catalog = {
  items: [
    {
      value: "MANAGE_ADMINS",
      label: "Gerenciar administradores",
      description: "Convidar, revogar acesso e alterar permissões.",
      sensitive: true,
    },
    {
      value: "VIEW_AUDIT",
      label: "Ver auditoria",
      description: "Consultar o histórico de operações administrativas.",
      sensitive: false,
    },
  ],
}

const emptyList = { body: [], headers: { "X-Total-Count": "0" } }

const securityRoutes = {
  ...signedInRoutes(),
  "GET /admin/permissions": { body: catalog },
  "GET /admin/security/overview": { body: overview },
  "GET /admin/audit-logs": emptyList,
  "GET /admin/sessions": { body: { items: [], total: 0 } },
}

const navTo = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const nav = screen.getByRole("navigation", { name: "Configurações e segurança" })
  await user.click(within(nav).getByRole("link", { name }))
}

/**
 * O conteúdo da página, sem o menu nem a barra do topo. Vários nomes aparecem
 * nos dois lugares — o nome do administrador logado, por exemplo — e a consulta
 * precisa dizer de qual deles se trata.
 */
const content = () => within(screen.getByRole("main"))

describe("minha conta", () => {
  it("mostra o que a API devolveu e diz o que não há registro, sem inventar data", async () => {
    const user = userEvent.setup()
    fakeApi(securityRoutes)
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Minha conta")

    expect(await screen.findByRole("heading", { name: "Ana Administradora" })).toBeTruthy()
    expect(screen.getByText("ana@ucb.edu.br")).toBeTruthy()
    // Senha nunca trocada: a tela afirma a ausência em vez de mostrar uma data.
    expect(
      screen.getByText("Nenhuma alteração registrada nesta conta"),
    ).toBeTruthy()
    expect(screen.getByText(/6 de 8 códigos de recuperação/)).toBeTruthy()
    // Rótulo da permissão vem do catálogo da API, não do código da tela.
    expect(screen.getByText("Gerenciar administradores")).toBeTruthy()
  })

  it("o dispositivo da sessão sai do user agent, sem telemetria inventada", async () => {
    const user = userEvent.setup()
    fakeApi(securityRoutes)
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Minha conta")
    await screen.findByRole("heading", { name: "Ana Administradora" })
    expect(screen.getByText(/macOS • Chrome/)).toBeTruthy()
  })

  it("trocar a senha exige a atual e só habilita com a política atendida", async () => {
    const user = userEvent.setup()
    const api = fakeApi({
      ...securityRoutes,
      "PATCH /admin/security/password": {
        body: { updated: true, sessionsRevoked: 1, delivery: "SENT" },
      },
    })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Minha conta")
    await screen.findByRole("heading", { name: "Ana Administradora" })
    // Dois caminhos levam à troca de senha: o do topo da página.
    await user.click(content().getAllByRole("button", { name: /alterar senha/i })[0])

    const dialog = await screen.findByRole("dialog")
    const save = within(dialog).getByRole("button", { name: /salvar nova senha/i })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    await user.type(within(dialog).getByLabelText("Senha atual"), "SenhaForte123!")
    await user.type(within(dialog).getByLabelText("Nova senha"), "fraca")
    // Política não atendida: continua bloqueado.
    expect((save as HTMLButtonElement).disabled).toBe(true)

    await user.clear(within(dialog).getByLabelText("Nova senha"))
    await user.type(within(dialog).getByLabelText("Nova senha"), "OutraSenhaForte456!")
    await user.type(
      within(dialog).getByLabelText("Confirmar nova senha"),
      "OutraSenhaForte456!",
    )
    expect((save as HTMLButtonElement).disabled).toBe(false)

    await user.click(save)
    await waitFor(() =>
      expect(api.find("PATCH", "/admin/security/password")).toHaveLength(1),
    )
    expect(api.find("PATCH", "/admin/security/password")[0].body).toEqual({
      currentPassword: "SenhaForte123!",
      password: "OutraSenhaForte456!",
    })
  })
})

describe("segurança da conta", () => {
  it("gerar códigos novos pede senha e código, e exibe o lote uma única vez", async () => {
    const user = userEvent.setup()
    const api = fakeApi({
      ...securityRoutes,
      "POST /admin/security/recovery-codes": {
        body: { recoveryCodes: ["AAAAA-11111", "BBBBB-22222"], remaining: 2 },
      },
    })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Segurança da conta")
    await user.click(await screen.findByRole("button", { name: /gerar novos códigos/i }))

    const dialog = await screen.findByRole("dialog")
    const confirm = within(dialog).getByRole("button", { name: /gerar novo lote/i })
    // Sem reautenticação completa o botão não libera.
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    await user.type(within(dialog).getByLabelText("Sua senha"), "SenhaForte123!")
    await user.type(within(dialog).getByLabelText("Dígito 1 de 6"), "123456")
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    await user.click(confirm)

    expect(await screen.findByText("AAAAA-11111")).toBeTruthy()
    expect(api.find("POST", "/admin/security/recovery-codes")[0].body).toEqual({
      password: "SenhaForte123!",
      twoFactorCode: "123456",
    })
    // Fechar só depois de confirmar que guardou.
    const done = screen.getByRole("button", { name: /já guardei os códigos/i })
    expect((done as HTMLButtonElement).disabled).toBe(true)
  })

  it("substituir o autenticador mostra o QR do servidor e só troca ao confirmar", async () => {
    const user = userEvent.setup()
    const qr = "data:image/png;base64,iVBORw0KGgo="
    const api = fakeApi({
      ...securityRoutes,
      "POST /admin/security/authenticator/start": {
        body: {
          setupTicket: "ticket-de-teste",
          expiresInMs: 600000,
          twoFactor: {
            secret: "SEGREDONOVO",
            otpauthUri: "otpauth://totp/x",
            qrCode: qr,
            issuer: "UniCarona Admin",
          },
        },
      },
      "POST /admin/security/authenticator/confirm": {
        body: { replaced: true, recoveryCodes: ["CCCCC-33333"] },
      },
    })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Segurança da conta")
    await user.click(
      await screen.findByRole("button", { name: /substituir autenticador/i }),
    )

    const start = await screen.findByRole("dialog")
    await user.type(within(start).getByLabelText("Sua senha"), "SenhaForte123!")
    await user.type(within(start).getByLabelText("Dígito 1 de 6"), "123456")
    await user.click(within(start).getByRole("button", { name: /começar substituição/i }))

    // O QR é o que o servidor mandou, não uma ilustração.
    const image = await screen.findByAltText("QR Code do autenticador")
    expect(image.getAttribute("src")).toBe(qr)

    const confirmDialog = screen.getByRole("dialog")
    await user.type(within(confirmDialog).getByLabelText("Dígito 1 de 6"), "654321")
    await user.click(
      within(confirmDialog).getByRole("button", { name: /confirmar e substituir/i }),
    )

    expect(await screen.findByText("CCCCC-33333")).toBeTruthy()
    expect(api.find("POST", "/admin/security/authenticator/confirm")[0].body).toEqual({
      setupTicket: "ticket-de-teste",
      code: "654321",
    })
  })

  it("código já usado na reautenticação manda esperar o próximo, não conferir a senha", async () => {
    const user = userEvent.setup()
    fakeApi({
      ...securityRoutes,
      "POST /admin/security/recovery-codes": {
        status: 401,
        body: {
          code: "ADMIN_REAUTH_CODE_ALREADY_USED",
          message: "Este código já foi usado. Aguarde o próximo código do autenticador.",
        },
      },
    })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Segurança da conta")
    await user.click(await screen.findByRole("button", { name: /gerar novos códigos/i }))

    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Sua senha"), "SenhaForte123!")
    await user.type(within(dialog).getByLabelText("Dígito 1 de 6"), "123456")
    await user.click(within(dialog).getByRole("button", { name: /gerar novo lote/i }))

    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toMatch(/aguarde o próximo código/i)
    expect(alert.textContent).not.toMatch(/senha incorreta/i)
  })

  it("encerrar outras sessões fica desabilitado quando não há nenhuma", async () => {
    const user = userEvent.setup()
    fakeApi({
      ...securityRoutes,
      "GET /admin/security/overview": {
        body: { ...overview, sessions: { ...overview.sessions, active: 1, others: 0 } },
      },
    })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Segurança da conta")
    const button = await screen.findByRole("button", { name: /encerrar outras sessões/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Nenhuma além desta")).toBeTruthy()
  })
})

describe("administradores", () => {
  const admins = {
    body: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        fullName: "Ana Administradora",
        email: "ana@ucb.edu.br",
        state: "ACTIVE",
        twoFactorEnabled: true,
        recoveryCodesRemaining: 6,
        permissions: ["MANAGE_ADMINS"],
        permissionsUpdatedAt: null,
        activeSessions: 1,
        createdAt: "2026-01-10T12:00:00.000Z",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        fullName: "Bruno Convidado",
        email: "bruno@ucb.edu.br",
        state: "PENDING_ACTIVATION",
        twoFactorEnabled: false,
        recoveryCodesRemaining: 0,
        permissions: [],
        permissionsUpdatedAt: null,
        createdAt: "2026-11-05T12:00:00.000Z",
        activeSessions: 0,
      },
    ],
    headers: { "X-Total-Count": "2", "X-Pending-Invites": "1" },
  }
  const routes = {
    ...securityRoutes,
    "GET /admin/admins": admins,
    "GET /admin/invites": emptyList,
    "GET /admin/mfa-recoveries": emptyList,
  }

  it("lista as contas com a situação derivada pelo servidor", async () => {
    const user = userEvent.setup()
    fakeApi(routes)
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Administradores")
    const table = within(await screen.findByRole("region", { name: /contas administrativas/i }))
    expect(table.getByText("Bruno Convidado")).toBeTruthy()
    // Tem o papel mas não confirmou o autenticador: não entra no painel.
    expect(table.getByText("Ativação pendente")).toBeTruthy()
  })

  it("o convite usa o endpoint real e avisa quando o e-mail não é entregue", async () => {
    const user = userEvent.setup()
    const api = fakeApi({
      ...routes,
      "POST /admin/invites": {
        status: 201,
        body: {
          invite: {
            id: "inv-1",
            email: "novo@ucb.edu.br",
            fullName: "Pessoa Nova",
            permissions: ["VIEW_AUDIT"],
            status: "PENDING",
            expiresAt: "2026-11-10T12:00:00.000Z",
          },
          delivery: "NOT_CONFIGURED",
        },
      },
    })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Administradores")
    await user.click(await screen.findByRole("button", { name: /convidar administrador/i }))

    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Nome completo"), "Pessoa Nova")
    await user.type(within(dialog).getByLabelText("E-mail institucional"), "novo@ucb.edu.br")
    await user.click(within(dialog).getByLabelText(/ver auditoria/i))
    await user.click(within(dialog).getByRole("button", { name: /enviar convite/i }))

    expect(api.find("POST", "/admin/invites")[0].body).toEqual({
      email: "novo@ucb.edu.br",
      fullName: "Pessoa Nova",
      permissions: ["VIEW_AUDIT"],
    })
    // Entrega diferente de SENT não pode aparecer como sucesso silencioso.
    expect(await screen.findByText(/não tem provedor de e-mail configurado/i)).toBeTruthy()
  })

  it("alterar permissões exige motivo e reautenticação no mesmo pedido", async () => {
    const user = userEvent.setup()
    const api = fakeApi({
      ...routes,
      "GET /admin/admins/11111111-1111-4111-8111-111111111111/sessions": {
        body: { items: [], total: 0 },
      },
      "PATCH /admin/admins/11111111-1111-4111-8111-111111111111/permissions": {
        body: {
          id: "11111111-1111-4111-8111-111111111111",
          permissions: ["MANAGE_ADMINS", "VIEW_AUDIT"],
          permissionsUpdatedAt: "2026-11-07T10:00:00.000Z",
        },
      },
    })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Administradores")
    await user.click(
      within(await screen.findByRole("region", { name: /contas administrativas/i })).getByRole(
        "button",
        { name: /^Ana Administradora/ },
      ),
    )
    await user.click(await screen.findByRole("button", { name: /alterar permissões/i }))

    const dialog = await screen.findByRole("dialog")
    const save = within(dialog).getByRole("button", { name: /salvar permissões/i })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    await user.click(within(dialog).getByLabelText(/ver auditoria/i))
    await user.type(
      within(dialog).getByLabelText("Motivo da alteração"),
      "Passa a acompanhar a auditoria",
    )
    await user.type(within(dialog).getByLabelText("Sua senha"), "SenhaForte123!")
    await user.type(within(dialog).getByLabelText("Dígito 1 de 6"), "123456")
    await user.click(save)

    await waitFor(() =>
      expect(
        api.find("PATCH", "/admin/admins/11111111-1111-4111-8111-111111111111/permissions"),
      ).toHaveLength(1),
    )
    expect(
      api.find("PATCH", "/admin/admins/11111111-1111-4111-8111-111111111111/permissions")[0]
        .body,
    ).toEqual({
      password: "SenhaForte123!",
      twoFactorCode: "123456",
      permissions: ["MANAGE_ADMINS", "VIEW_AUDIT"],
      reason: "Passa a acompanhar a auditoria",
    })
  })

  it("encerrar acesso e suspender a conta são ações distintas na tela", async () => {
    const user = userEvent.setup()
    fakeApi({
      ...routes,
      "GET /admin/admins/11111111-1111-4111-8111-111111111111/sessions": {
        body: { items: [], total: 0 },
      },
    })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Administradores")
    await user.click(
      within(await screen.findByRole("region", { name: /contas administrativas/i })).getByRole(
        "button",
        { name: /^Ana Administradora/ },
      ),
    )
    await user.click(await screen.findByRole("button", { name: /encerrar acesso/i }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/não exclui nem suspende/i)).toBeTruthy()
  })
})

describe("regressões visuais de segurança", () => {
  it("mantém os links da seção Segurança e acesso navegáveis ao recolher e expandir o menu", async () => {
    const user = userEvent.setup()
    fakeApi(securityRoutes)
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })

    const securityNav = screen.getByRole("navigation", { name: "Configurações e segurança" })
    await user.click(screen.getByRole("button", { name: "Recolher menu" }))
    expect(document.querySelector(".sidebar-collapsed")).not.toBeNull()
    expect(securityNav.classList.contains("nav-list-security")).toBe(true)

    await user.click(within(securityNav).getByRole("link", { name: "Segurança da conta" }))
    expect(await screen.findByRole("heading", { name: "Segurança da conta" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Expandir menu" }))
    expect(document.querySelector(".sidebar-collapsed")).toBeNull()
  })

  it("alterna a visibilidade de senha no modal sem alterar o valor digitado", async () => {
    const user = userEvent.setup()
    fakeApi(securityRoutes)
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    await navTo(user, "Segurança da conta")
    await user.click(await screen.findByRole("button", { name: "Trocar senha" }))

    const dialog = await screen.findByRole("dialog")
    const password = within(dialog).getByLabelText<HTMLInputElement>("Nova senha")
    await user.type(password, "SenhaTeste123!")
    expect(password.type).toBe("password")
    await user.click(within(dialog).getAllByRole("button", { name: "Mostrar senha" })[1])
    expect(password.type).toBe("text")
    expect(password.value).toBe("SenhaTeste123!")
    await user.click(within(dialog).getByRole("button", { name: "Ocultar senha" }))
    expect(password.type).toBe("password")
  })
})

describe("menu de segurança e permissão", () => {
  it("sem MANAGE_ADMINS o link de administradores não é oferecido", async () => {
    fakeApi({
      ...securityRoutes,
      "GET /admin/auth/session": { body: { ...adminUser, permissions: ["VIEW_AUDIT"] } },
    })
    render(<App />)
    await screen.findByRole("heading", { name: "Visão geral" })
    const nav = screen.getByRole("navigation", { name: "Configurações e segurança" })
    expect(within(nav).queryByRole("link", { name: "Administradores" })).toBeNull()
    // As telas da própria conta continuam acessíveis.
    expect(within(nav).getByRole("link", { name: "Minha conta" })).toBeTruthy()
  })
})
