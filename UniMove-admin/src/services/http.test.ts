import { afterEach, describe, expect, it, vi } from "vitest"
import { fakeApi } from "../test/fakeApi"
import { ADMIN_API_MISSING, ApiError, request, setSessionListeners } from "./http"

afterEach(() => setSessionListeners({}))

describe("cliente HTTP", () => {
  it("manda CSRF só em escrita e sempre com cookie da própria origem", async () => {
    document.cookie = "uc_admin_csrf=token-csrf"
    const api = fakeApi({
      "GET /x": { body: {} },
      "PATCH /x": { body: {} },
    })
    const fetchMock = vi.mocked(fetch)
    await request("/x")
    await request("/x", { method: "PATCH", body: "{}" })
    expect(api.calls[0].headers.get("x-csrf-token")).toBeNull()
    expect(api.calls[1].headers.get("x-csrf-token")).toBe("token-csrf")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/x")
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("same-origin")
  })

  it("nunca guarda credencial no armazenamento do navegador", async () => {
    fakeApi({ "GET /x": { body: {} } })
    await request("/x")
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it("401 renova a sessão uma vez e repete o pedido", async () => {
    let authorized = false
    const api = fakeApi({
      "GET /x": () =>
        authorized ? { body: { ok: true } } : { status: 401, body: {} },
      "POST /admin/auth/refresh": () => {
        authorized = true
        return { body: { refreshed: true } }
      },
    })
    await expect(request("/x")).resolves.toMatchObject({ data: { ok: true } })
    expect(api.find("POST", "/admin/auth/refresh")).toHaveLength(1)
    expect(api.find("GET", "/x")).toHaveLength(2)
  })

  it("vários 401 ao mesmo tempo geram um único refresh", async () => {
    let authorized = false
    const api = fakeApi({
      "GET /a": () => (authorized ? { body: 1 } : { status: 401, body: {} }),
      "GET /b": () => (authorized ? { body: 2 } : { status: 401, body: {} }),
      "POST /admin/auth/refresh": () => {
        authorized = true
        return { body: {} }
      },
    })
    await Promise.all([request("/a"), request("/b"), request("/a")])
    expect(api.find("POST", "/admin/auth/refresh")).toHaveLength(1)
  })

  it("refresh recusado avisa sessão expirada", async () => {
    const onExpired = vi.fn()
    setSessionListeners({ onExpired })
    fakeApi({
      "GET /x": { status: 401, body: { message: "Expirado" } },
      "POST /admin/auth/refresh": { status: 401, body: {} },
    })
    await expect(request("/x")).rejects.toMatchObject({ status: 401 })
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it("outra aba já renovou: refresh falha, mas o pedido repetido passa", async () => {
    const onExpired = vi.fn()
    setSessionListeners({ onExpired })
    let attempts = 0
    fakeApi({
      "GET /x": () =>
        ++attempts === 1 ? { status: 401, body: {} } : { body: { ok: true } },
      "POST /admin/auth/refresh": { status: 401, body: {} },
    })
    await expect(request("/x")).resolves.toMatchObject({ data: { ok: true } })
    expect(onExpired).not.toHaveBeenCalled()
  })

  it("perda de acesso avisa; recusa de CSRF não derruba a sessão", async () => {
    const onForbidden = vi.fn()
    setSessionListeners({ onForbidden })
    fakeApi({
      "GET /role": {
        status: 403,
        body: { code: "HTTP_403", message: "Perfil sem permissão" },
      },
      "POST /csrf": {
        status: 403,
        body: { code: "ADMIN_CSRF_REJECTED", message: "Falha" },
      },
    })
    await expect(request("/role")).rejects.toBeInstanceOf(ApiError)
    expect(onForbidden).toHaveBeenCalledOnce()
    await expect(request("/csrf", { method: "POST" })).rejects.toMatchObject({
      code: "ADMIN_CSRF_REJECTED",
    })
    expect(onForbidden).toHaveBeenCalledOnce()
  })

  it("junta mensagens de validação e explica servidor fora do ar", async () => {
    fakeApi({
      "GET /v": { status: 400, body: { message: ["a inválido", "b inválido"] } },
      "GET /down": { status: 503, body: undefined },
    })
    await expect(request("/v")).rejects.toThrow("a inválido b inválido")
    await expect(request("/down")).rejects.toThrow(/indisponível/)
  })

  it("renovação com o servidor fora do ar não encerra a sessão", async () => {
    const onExpired = vi.fn()
    setSessionListeners({ onExpired })
    fakeApi({
      "GET /x": { status: 401, body: {} },
      "POST /admin/auth/refresh": { status: 503 },
    })
    await expect(request("/x")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    })
    expect(onExpired).not.toHaveBeenCalled()
  })

  it("401 depois de renovar encerra a sessão em vez de virar erro solto", async () => {
    const onExpired = vi.fn()
    setSessionListeners({ onExpired })
    fakeApi({
      "GET /x": { status: 401, body: {} },
      "POST /admin/auth/refresh": { body: {} },
    })
    await expect(request("/x")).rejects.toMatchObject({ status: 401 })
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it("rota administrativa ausente explica a publicação, sem texto técnico", async () => {
    fakeApi({
      "GET /nest": {
        status: 404,
        body: { code: "HTTP_404", message: "Cannot GET /api/v1/nest" },
      },
      "GET /registro": {
        status: 404,
        body: { code: "HTTP_404", message: "Usuário não encontrado." },
      },
    })
    const missing = await request("/nest").catch((error: ApiError) => error)
    expect(missing).toMatchObject({ code: ADMIN_API_MISSING })
    expect((missing as ApiError).message).not.toContain("Cannot GET")
    await expect(request("/registro")).rejects.toThrow("Usuário não encontrado.")
  })

  it("resposta que não é JSON vira erro legível", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<!doctype html>", { status: 200 })),
    )
    const error = await request("/x").catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe("INVALID_RESPONSE")
    expect((error as ApiError).message).not.toContain("Unexpected token")
  })

  it("falha de rede vira erro legível", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")))
    await expect(request("/x")).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    })
  })
})
