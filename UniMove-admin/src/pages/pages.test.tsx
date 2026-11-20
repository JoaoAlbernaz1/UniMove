import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import App from "../App"
import { adminUser, fakeApi, signedInRoutes } from "../test/fakeApi"

const STUDENT_ID = "22222222-2222-4222-8222-222222222222"

const pendingVerification = {
  userId: STUDENT_ID,
  reportGuid: "8f3a19c2-7db4-40e1-9d8c-2bc971a044f2",
  status: "PENDING_REVIEW",
  submittedAt: "2026-11-03T12:00:00.000Z",
  reviewedAt: null,
  reviewNote: null,
  reviewedBy: null,
  user: {
    fullName: "Lucas Ferreira",
    institutionalEmail: "lucas@ucb.edu.br",
    studentNumber: "2023000001",
    course: "Direito",
  },
}

function verificationRoutes() {
  const routes = signedInRoutes()
  let items: unknown[] = [pendingVerification]
  routes["GET /admin/academic-verifications"] = (call) => {
    const list = call.search.get("status") === "PENDING_REVIEW" ? items : []
    return { body: list, headers: { "X-Total-Count": String(list.length) } }
  }
  return { routes, clear: () => (items = []) }
}

describe("verificações", () => {
  async function openReview(user: ReturnType<typeof userEvent.setup>) {
    render(<App />)
    await user.click(await screen.findByRole("button", { name: /revisar/i }))
    return screen.findByRole("dialog", { name: "Revisão de vínculo" })
  }

  it("lista dados reais, GUID e link oficial; sem visualizador de PDF", async () => {
    window.history.pushState(null, "", "/verificacoes")
    const user = userEvent.setup()
    const { routes } = verificationRoutes()
    fakeApi(routes)
    const dialog = await openReview(user)
    expect(within(dialog).getByText(pendingVerification.reportGuid)).toBeTruthy()
    expect(within(dialog).getByText("2023000001")).toBeTruthy()
    const link = within(dialog).getByRole<HTMLAnchorElement>("link", { name: /validador oficial/i })
    expect(link.href).toContain("portalacademico.ubec.edu.br")
    expect(link.rel).toContain("noopener")
    expect(document.querySelector("embed, iframe, object")).toBeNull()
  })

  it("aprova só depois de confirmar, e a lista atualiza", async () => {
    window.history.pushState(null, "", "/verificacoes")
    const user = userEvent.setup()
    const { routes, clear } = verificationRoutes()
    routes[`PATCH /admin/academic-verifications/${STUDENT_ID}`] = () => {
      clear()
      return { body: {} }
    }
    const api = fakeApi(routes)
    const dialog = await openReview(user)
    await user.click(within(dialog).getByRole("button", { name: /aprovar vínculo/i }))
    expect(api.find("PATCH", `/admin/academic-verifications/${STUDENT_ID}`)).toHaveLength(0)
    await user.click(await screen.findByRole("button", { name: "Confirmar aprovação" }))
    expect(await screen.findByText("Nenhuma solicitação pendente")).toBeTruthy()
    expect(api.find("PATCH", `/admin/academic-verifications/${STUDENT_ID}`)[0].body).toEqual({
      status: "APPROVED",
    })
  })

  it("rejeição não sai sem motivo, e envia o motivo digitado", async () => {
    window.history.pushState(null, "", "/verificacoes")
    const user = userEvent.setup()
    const { routes, clear } = verificationRoutes()
    routes[`PATCH /admin/academic-verifications/${STUDENT_ID}`] = () => {
      clear()
      return { body: {} }
    }
    const api = fakeApi(routes)
    const dialog = await openReview(user)
    await user.click(within(dialog).getByRole("button", { name: /rejeitar vínculo/i }))
    const confirm = await screen.findByRole<HTMLButtonElement>("button", { name: "Confirmar rejeição" })
    expect(confirm.disabled).toBe(true)
    await user.type(screen.getByLabelText("Motivo obrigatório"), "   ")
    expect(confirm.disabled).toBe(true)
    await user.type(screen.getByLabelText("Motivo obrigatório"), "GUID não confere")
    await user.click(confirm)
    await screen.findByText("Nenhuma solicitação pendente")
    expect(api.find("PATCH", `/admin/academic-verifications/${STUDENT_ID}`)[0].body).toEqual({
      status: "REJECTED",
      reviewNote: "GUID não confere",
    })
  })

  it("erro do backend não finge sucesso: o modal fica aberto com o motivo", async () => {
    window.history.pushState(null, "", "/verificacoes")
    const user = userEvent.setup()
    const { routes } = verificationRoutes()
    routes[`PATCH /admin/academic-verifications/${STUDENT_ID}`] = {
      status: 500,
      body: { message: "Erro interno do servidor." },
    }
    fakeApi(routes)
    const dialog = await openReview(user)
    await user.click(within(dialog).getByRole("button", { name: /rejeitar vínculo/i }))
    await user.type(await screen.findByLabelText("Motivo obrigatório"), "Motivo escrito")
    await user.click(screen.getByRole("button", { name: "Confirmar rejeição" }))
    expect(await screen.findByText(/O servidor retornou erro 500 durante a rejeição/)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Confirmar rejeição" }).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLTextAreaElement>("Motivo obrigatório").value).toBe("Motivo escrito")
    expect(screen.getAllByText("Lucas Ferreira").length).toBeGreaterThan(0)
  })

  it("erro 500 na aprovação impede reenvio e não informa sucesso", async () => {
    window.history.pushState(null, "", "/verificacoes")
    const user = userEvent.setup()
    const { routes } = verificationRoutes()
    routes[`PATCH /admin/academic-verifications/${STUDENT_ID}`] = {
      status: 500,
      body: { message: "Erro interno do servidor.", code: "HTTP_500" },
    }
    const api = fakeApi(routes)
    const dialog = await openReview(user)
    await user.click(within(dialog).getByRole("button", { name: /aprovar vínculo/i }))
    await user.click(await screen.findByRole("button", { name: "Confirmar aprovação" }))

    expect(await screen.findByText(/O servidor retornou erro 500 durante a aprovação/)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Confirmar aprovação" }).disabled).toBe(true)
    expect(api.find("PATCH", `/admin/academic-verifications/${STUDENT_ID}`)).toHaveLength(1)
    expect(screen.queryByText("Vínculo de Lucas Ferreira aprovado.")).toBeNull()
  })

  it("conflito 409 avisa e recarrega a lista", async () => {
    window.history.pushState(null, "", "/verificacoes")
    const user = userEvent.setup()
    const { routes, clear } = verificationRoutes()
    routes[`PATCH /admin/academic-verifications/${STUDENT_ID}`] = () => {
      clear()
      return {
        status: 409,
        body: {
          code: "VERIFICATION_ALREADY_DECIDED",
          message: "Esta validação já foi decidida por outro administrador.",
        },
      }
    }
    fakeApi(routes)
    const dialog = await openReview(user)
    await user.click(within(dialog).getByRole("button", { name: /aprovar vínculo/i }))
    await user.click(await screen.findByRole("button", { name: "Confirmar aprovação" }))
    expect(await screen.findByText(/já foi decidida/)).toBeTruthy()
    expect(await screen.findByText("Nenhuma solicitação pendente")).toBeTruthy()
  })
})

const studentRow = {
  id: STUDENT_ID,
  fullName: "Marina Oliveira",
  institutionalEmail: "marina@ucb.edu.br",
  course: "Direito",
  status: "ACTIVE",
  createdAt: "2026-10-01T12:00:00.000Z",
  deletedAt: null,
  roles: ["DRIVER", "PASSENGER"],
  verificationStatus: null,
}

const studentDetail = {
  ...studentRow,
  studentNumber: "2023000002",
  semester: 3,
  profileCompletedAt: null,
  academicVerification: null,
  vehicles: [],
  counts: { drivenRides: 1, reservations: 0, incidentsReported: 0, incidentsAgainst: 0 },
  rating: { average: null, count: 0 },
  adminHistory: [],
}

const noImpact = {
  ridesInProgress: 0,
  futureRidesAsDriver: 0,
  passengersAffected: 0,
  reservationsAsPassenger: 0,
  pendingRequestsAsPassenger: 0,
}

function usersRoutes(detail: object = studentDetail) {
  const routes = signedInRoutes()
  routes["GET /admin/users"] = { body: [studentRow], headers: { "X-Total-Count": "41" } }
  routes[`GET /admin/users/${STUDENT_ID}`] = { body: detail }
  routes[`GET /admin/users/${STUDENT_ID}/impact`] = { body: noImpact }
  return routes
}

describe("usuários", () => {
  async function openDetail(user: ReturnType<typeof userEvent.setup>) {
    render(<App />)
    await user.click(await screen.findByRole("button", { name: "Ver Marina Oliveira" }))
    return screen.findByRole("dialog", { name: "Perfil do usuário" })
  }

  it("identifica motorista e verificação ausente, e pagina pela API", async () => {
    window.history.pushState(null, "", "/usuarios")
    const user = userEvent.setup()
    const api = fakeApi(usersRoutes())
    render(<App />)
    const row = (await screen.findByText("Marina Oliveira")).closest("tr")!
    expect(within(row).getByText("Motorista")).toBeTruthy()
    expect(within(row).getByText("Não enviada")).toBeTruthy()
    expect(screen.getByText("Página 1 de 3")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Próxima página" }))
    await waitFor(() =>
      expect(api.find("GET", "/admin/users").at(-1)?.search.get("page")).toBe("2"),
    )
  })

  it("filtros e busca vão para a API", async () => {
    window.history.pushState(null, "", "/usuarios")
    const user = userEvent.setup()
    const api = fakeApi(usersRoutes())
    render(<App />)
    await screen.findByText("Marina Oliveira")
    await user.selectOptions(screen.getByLabelText("Filtrar situação"), "SUSPENDED")
    await user.selectOptions(screen.getByLabelText("Filtrar verificação"), "NONE")
    await user.type(screen.getByLabelText(/buscar por nome/i), "marina")
    await waitFor(() => {
      const last = api.find("GET", "/admin/users").at(-1)!
      expect(last.search.get("status")).toBe("SUSPENDED")
      expect(last.search.get("verification")).toBe("NONE")
      expect(last.search.get("q")).toBe("marina")
    })
  })

  it("suspensão exige motivo e só informa sucesso após a API", async () => {
    window.history.pushState(null, "", "/usuarios")
    const user = userEvent.setup()
    const routes = usersRoutes()
    routes[`PATCH /admin/users/${STUDENT_ID}/status`] = {
      body: {
        id: STUDENT_ID,
        status: "SUSPENDED",
        consequences: { ridesCancelled: 0, reservationsCancelled: 0, requestsCancelled: 0 },
        notificationsDelivered: true,
      },
    }
    const api = fakeApi(routes)
    const dialog = await openDetail(user)
    await user.click(within(dialog).getByRole("button", { name: "Suspender conta" }))
    const confirm = await screen.findByRole<HTMLButtonElement>("button", { name: "Confirmar suspensão" })
    expect(confirm.disabled).toBe(true)
    await user.type(screen.getByLabelText("Motivo obrigatório"), "Conduta em análise")
    await user.click(confirm)
    expect(await screen.findByText("Conta suspensa.")).toBeTruthy()
    expect(api.find("PATCH", `/admin/users/${STUDENT_ID}/status`)[0].body).toEqual({
      status: "SUSPENDED",
      reason: "Conduta em análise",
    })
  })

  it("mostra o impacto e confirma cancelamentos explicitamente", async () => {
    window.history.pushState(null, "", "/usuarios")
    const user = userEvent.setup()
    const routes = usersRoutes()
    routes[`GET /admin/users/${STUDENT_ID}/impact`] = {
      body: { ...noImpact, futureRidesAsDriver: 2, passengersAffected: 3 },
    }
    routes[`PATCH /admin/users/${STUDENT_ID}/status`] = {
      body: {
        id: STUDENT_ID,
        status: "SUSPENDED",
        consequences: { ridesCancelled: 2, reservationsCancelled: 3, requestsCancelled: 0 },
        notificationsDelivered: false,
      },
    }
    const api = fakeApi(routes)
    const dialog = await openDetail(user)
    await user.click(within(dialog).getByRole("button", { name: "Suspender conta" }))
    expect(await screen.findByText(/2 caronas futuras como motorista, afetando 3 passageiros/)).toBeTruthy()
    await user.type(screen.getByLabelText("Motivo obrigatório"), "Denúncia grave")
    await user.click(screen.getByRole("button", { name: "Confirmar suspensão" }))
    expect(await screen.findByText(/não foi notificada/)).toBeTruthy()
    expect(api.find("PATCH", `/admin/users/${STUDENT_ID}/status`)[0].body).toMatchObject({
      confirmImpact: true,
    })
  })

  it("não oferece ação em conta excluída nem na própria conta", async () => {
    window.history.pushState(null, "", "/usuarios")
    const user = userEvent.setup()
    fakeApi(usersRoutes({ ...studentDetail, status: "DEACTIVATED", deletedAt: "2026-10-02T00:00:00.000Z" }))
    const dialog = await openDetail(user)
    expect(within(dialog).queryByRole("button", { name: /reativar|suspender|bloquear/i })).toBeNull()
  })

  it("detalhe da própria conta também não tem ação", async () => {
    window.history.pushState(null, "", "/usuarios")
    const user = userEvent.setup()
    const routes = usersRoutes()
    routes[`GET /admin/users/${STUDENT_ID}`] = { body: { ...studentDetail, id: adminUser.id } }
    routes["GET /admin/auth/session"] = { body: { ...adminUser, id: STUDENT_ID } }
    fakeApi(routes)
    const dialog = await openDetail(user)
    expect(within(dialog).queryByRole("button", { name: /suspender|bloquear/i })).toBeNull()
  })
})

describe("caronas e denúncias", () => {
  it("atualiza novas caronas ao clicar e ao voltar para a aba", async () => {
    window.history.pushState(null, "", "/caronas")
    const user = userEvent.setup()
    const routes = signedInRoutes()
    const ride = {
      id: STUDENT_ID,
      status: "OPEN",
      departureAt: "2026-11-20T18:00:00.000Z",
      totalSeats: 4,
      availableSeats: 3,
      pricePerPersonCents: 700,
      driver: { id: "driver-1", fullName: "Motorista Novo" },
      originLocation: { name: "Ceilândia" },
      destinationLocation: { name: "Taguatinga" },
    }
    let items: typeof ride[] = []
    routes["GET /admin/rides"] = () => ({
      body: items,
      headers: {
        "X-Total-Count": String(items.length),
        "X-Status-Counts": JSON.stringify({ OPEN: items.length }),
      },
    })
    const api = fakeApi(routes)
    render(<App />)

    expect(await screen.findByText("Nenhum resultado encontrado")).toBeTruthy()
    const initiallyLoaded = api.find("GET", "/admin/rides").length

    // Uma carona foi cadastrada depois que a tela já estava aberta.
    items = [ride]
    await user.click(screen.getByRole("button", { name: "Atualizar caronas" }))
    expect(await screen.findByText("Motorista Novo")).toBeTruthy()
    expect(api.find("GET", "/admin/rides").length).toBeGreaterThan(initiallyLoaded)

    // Ao voltar à aba, a tela busca o estado atual, inclusive remoções.
    items = []
    fireEvent(document, new Event("visibilitychange"))
    expect(await screen.findByText("Nenhum resultado encontrado")).toBeTruthy()
    expect(screen.queryByText("Motorista Novo")).toBeNull()
  })

  it("cancelamento de carona não existe na tela e valor não vira pagamento", async () => {
    window.history.pushState(null, "", "/caronas")
    const user = userEvent.setup()
    const ride = {
      id: STUDENT_ID,
      status: "OPEN",
      departureAt: "2026-11-05T21:00:00.000Z",
      totalSeats: 4,
      availableSeats: 2,
      pricePerPersonCents: 800,
      driver: { id: "d", fullName: "Motorista Real" },
      originLocation: { name: "Águas Claras" },
      destinationLocation: { name: "UCB" },
    }
    const routes = signedInRoutes()
    routes["GET /admin/rides"] = {
      body: [ride],
      headers: { "X-Total-Count": "1", "X-Status-Counts": '{"OPEN":7}' },
    }
    routes[`GET /admin/rides/${STUDENT_ID}`] = {
      body: {
        ...ride,
        createdAt: ride.departureAt,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        additionalInfo: null,
        vehicle: { brand: "Honda", model: "Fit", color: "Prata", plate: "Q••••21" },
        requests: [],
        reservations: [],
        cancellations: [],
        incidents: [],
      },
    }
    fakeApi(routes)
    render(<App />)
    expect(await screen.findByText("Motorista Real")).toBeTruthy()
    expect(screen.getByText("7")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: /Ver carona/ }))
    const dialog = await screen.findByRole("dialog", { name: /Detalhes da carona/ })
    expect(await within(dialog).findByText(/não representa pagamento/)).toBeTruthy()
    expect(within(dialog).queryByRole("button", { name: /cancelar carona/i })).toBeNull()
  })

  it("decisão final de denúncia exige justificativa no cliente e no envio", async () => {
    window.history.pushState(null, "", "/moderacao")
    const user = userEvent.setup()
    const person = { id: "p", fullName: "Pessoa Denunciante" }
    const row = {
      id: STUDENT_ID,
      rideId: STUDENT_ID,
      type: "SAFETY_CONCERN",
      status: "OPEN",
      createdAt: "2026-11-03T12:00:00.000Z",
      resolvedAt: null,
      reportedBy: person,
      reportedUser: { id: "q", fullName: "Pessoa Denunciada" },
    }
    const routes = signedInRoutes()
    routes["GET /admin/incidents"] = {
      body: [row],
      headers: { "X-Total-Count": "1", "X-Status-Counts": '{"OPEN":1}' },
    }
    routes[`GET /admin/incidents/${STUDENT_ID}`] = {
      body: {
        ...row,
        description: "Relato real da denúncia",
        decisions: [],
        ride: {
          id: STUDENT_ID,
          status: "COMPLETED",
          departureAt: row.createdAt,
          driver: person,
          originLocation: { name: "A" },
          destinationLocation: { name: "B" },
        },
      },
    }
    routes[`PATCH /admin/incidents/${STUDENT_ID}`] = {
      body: { id: STUDENT_ID, status: "RESOLVED", notificationDelivered: true },
    }
    const api = fakeApi(routes)
    render(<App />)
    await user.click(await screen.findByRole("button", { name: /analisar/i }))
    expect(await screen.findByText("Relato real da denúncia")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Resolver denúncia" }))
    expect(await screen.findByText(/Registre a justificativa/)).toBeTruthy()
    expect(api.find("PATCH", `/admin/incidents/${STUDENT_ID}`)).toHaveLength(0)
    await user.type(screen.getByLabelText("Registro da análise"), "Orientação enviada")
    await user.click(screen.getByRole("button", { name: "Resolver denúncia" }))
    await waitFor(() =>
      expect(api.find("PATCH", `/admin/incidents/${STUDENT_ID}`)[0]?.body).toEqual({
        status: "RESOLVED",
        note: "Orientação enviada",
      }),
    )
    expect(screen.getByRole<HTMLButtonElement>("tab", { name: /avaliações sinalizadas/i }).disabled).toBe(true)
  })
})

describe("relatórios", () => {
  it("sem base mostra 'Sem dados', e a estimativa avisa que não é pagamento", async () => {
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
    fakeApi(routes)
    render(<App />)
    expect((await screen.findAllByText("Sem dados")).length).toBe(3)
    expect(screen.getByText("Não representa pagamentos")).toBeTruthy()
    expect(screen.getByText(/sem CPF, e-mail, matrícula/)).toBeTruthy()
  })
})
