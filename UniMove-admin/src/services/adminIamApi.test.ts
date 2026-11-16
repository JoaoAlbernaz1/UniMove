import { describe, expect, it } from "vitest"
import { fakeApi } from "../test/fakeApi"
import { ApiError } from "./http"
import {
  adminAccountsApi,
  inviteAcceptanceApi,
  invitesApi,
  mfaRecoveryApi,
  passwordResetApi,
  permissionsApi,
  sessionsApi,
} from "./adminIamApi"

const reauth = { password: "SenhaForte123!", twoFactorCode: "123456" }

describe("contratos da gestão de acesso administrativo", () => {
  it("lê o catálogo de permissões do servidor, sem repetir rótulo na tela", async () => {
    fakeApi({
      "GET /admin/permissions": {
        body: {
          items: [
            {
              value: "MANAGE_ADMINS",
              label: "Gerenciar administradores",
              description: "Convidar e revogar acesso.",
              sensitive: true,
            },
          ],
        },
      },
    })
    await expect(permissionsApi.catalog()).resolves.toEqual([
      {
        value: "MANAGE_ADMINS",
        label: "Gerenciar administradores",
        description: "Convidar e revogar acesso.",
        sensitive: true,
      },
    ])
  })

  it("a lista de administradores lê total e convites em aberto dos cabeçalhos", async () => {
    const api = fakeApi({
      "GET /admin/admins": {
        body: [{ id: "a", fullName: "Ana", email: "ana@ucb.edu.br" }],
        headers: { "X-Total-Count": "7", "X-Pending-Invites": "2" },
      },
    })
    const result = await adminAccountsApi.list({ page: 2, q: "ana" })
    expect(result).toMatchObject({ total: 7, pendingInvites: 2 })
    expect(result.items).toHaveLength(1)
    const [call] = api.find("GET", "/admin/admins")
    expect(call.search.get("page")).toBe("2")
    expect(call.search.get("q")).toBe("ana")
    expect(call.search.get("limit")).not.toBeNull()
  })

  it("alterar permissões vai em PATCH com reautenticação e motivo no corpo", async () => {
    const api = fakeApi({
      "PATCH /admin/admins/abc/permissions": {
        body: { id: "abc", permissions: ["VIEW_AUDIT"], permissionsUpdatedAt: "2026-11-07" },
      },
    })
    await adminAccountsApi.updatePermissions("abc", {
      ...reauth,
      permissions: ["VIEW_AUDIT"],
      reason: "Motivo registrado",
    })
    const [call] = api.find("PATCH", "/admin/admins/abc/permissions")
    expect(call.body).toEqual({
      ...reauth,
      permissions: ["VIEW_AUDIT"],
      reason: "Motivo registrado",
    })
    expect(call.headers.get("Content-Type")).toBe("application/json")
  })

  it("revogar acesso e derrubar sessões de outra conta exigem reautenticação", async () => {
    const api = fakeApi({
      "POST /admin/admins/abc/revoke": { body: { revoked: true } },
      "POST /admin/admins/abc/sessions/revoke": { body: { revoked: 3 } },
    })
    await adminAccountsApi.revokeAccess("abc", { ...reauth, reason: "Saiu da equipe" })
    await adminAccountsApi.revokeSessionsOf("abc", reauth)
    expect(api.find("POST", "/admin/admins/abc/revoke")[0].body).toMatchObject(reauth)
    expect(api.find("POST", "/admin/admins/abc/sessions/revoke")[0].body).toEqual(reauth)
  })

  it("emitir convite devolve o estado de entrega junto do convite", async () => {
    fakeApi({
      "POST /admin/invites": {
        status: 201,
        body: {
          invite: { id: "i1", email: "nova@ucb.edu.br", status: "PENDING" },
          delivery: "NOT_CONFIGURED",
        },
      },
    })
    // Entrega diferente de SENT precisa chegar à tela: o convite existe, mas
    // ninguém recebeu o link.
    await expect(
      invitesApi.create({
        email: "nova@ucb.edu.br",
        fullName: "Pessoa Nova",
        permissions: ["VIEW_AUDIT"],
      }),
    ).resolves.toMatchObject({ delivery: "NOT_CONFIGURED" })
  })

  it("a lista de convites repassa o filtro de situação", async () => {
    const api = fakeApi({
      "GET /admin/invites": { body: [], headers: { "X-Total-Count": "0" } },
    })
    await invitesApi.list({ status: "PENDING" })
    expect(api.find("GET", "/admin/invites")[0].search.get("status")).toBe("PENDING")
  })

  it("os três passos do aceite não usam sessão e não tentam renovar nada", async () => {
    const api = fakeApi({
      "POST /admin/auth/invites/confirm-email": {
        body: { email: "nova@ucb.edu.br", accountExists: false },
      },
      "POST /admin/auth/invites/password": {
        body: { twoFactor: { secret: "S", otpauthUri: "otpauth://", qrCode: "data:", issuer: "x" } },
      },
      "POST /admin/auth/invites/two-factor": {
        body: { activated: true, inviteId: "i1", recoveryCodes: ["AAAAA-BBBBB"] },
      },
    })
    await inviteAcceptanceApi.confirmEmail("token-de-teste-com-tamanho-ok")
    await inviteAcceptanceApi.setPassword({
      token: "token-de-teste-com-tamanho-ok",
      cpf: "52998224725",
      password: "SenhaForte123!",
    })
    const result = await inviteAcceptanceApi.confirmTwoFactor(
      "token-de-teste-com-tamanho-ok",
      "123456",
    )
    expect(result.recoveryCodes).toEqual(["AAAAA-BBBBB"])
    expect(api.find("POST", "/admin/auth/refresh")).toHaveLength(0)
  })

  it("rota pública não dispara renovação de sessão quando responde 401", async () => {
    const api = fakeApi({
      "POST /admin/auth/invites/confirm-email": {
        status: 401,
        body: { code: "ADMIN_INVITE_INVALID", message: "Convite inválido." },
      },
    })
    await expect(inviteAcceptanceApi.confirmEmail("token-invalido-mas-longo-ok")).rejects.toThrow(
      ApiError,
    )
    expect(api.find("POST", "/admin/auth/refresh")).toHaveLength(0)
  })

  it("redefinição de senha manda só o e-mail e depois token e senha", async () => {
    const api = fakeApi({
      "POST /admin/auth/password-reset": { status: 202, body: { accepted: true, message: "ok" } },
      "POST /admin/auth/password-reset/confirm": {
        body: { updated: true, twoFactorStillRequired: true },
      },
    })
    await passwordResetApi.request("ana@ucb.edu.br")
    const result = await passwordResetApi.confirm("token-longo-de-teste-ok", "OutraSenha456!")
    expect(api.find("POST", "/admin/auth/password-reset")[0].body).toEqual({
      email: "ana@ucb.edu.br",
    })
    expect(result.twoFactorStillRequired).toBe(true)
  })

  it("o pedido de recuperação do fator sempre leva a senha", async () => {
    const api = fakeApi({
      "POST /admin/auth/mfa-recovery": { status: 202, body: { accepted: true, message: "ok" } },
      "POST /admin/auth/mfa-recovery/start": {
        body: { twoFactor: { secret: "S", otpauthUri: "o", qrCode: "d", issuer: "x" } },
      },
      "POST /admin/auth/mfa-recovery/confirm": {
        body: { completed: true, recoveryCodes: ["AAAAA-BBBBB"] },
      },
    })
    await mfaRecoveryApi.request({
      email: "ana@ucb.edu.br",
      password: "SenhaForte123!",
      reason: "Perdi o celular com o autenticador",
    })
    await mfaRecoveryApi.start("token-longo-de-teste-ok", "SenhaForte123!")
    await mfaRecoveryApi.confirm("token-longo-de-teste-ok", "123456")
    expect(api.find("POST", "/admin/auth/mfa-recovery")[0].body).toMatchObject({
      password: "SenhaForte123!",
    })
    // O link sozinho não basta: o passo de troca também pede a senha.
    expect(api.find("POST", "/admin/auth/mfa-recovery/start")[0].body).toMatchObject({
      password: "SenhaForte123!",
    })
  })

  it("revisar pedido de recuperação exige reautenticação do revisor", async () => {
    const api = fakeApi({
      "POST /admin/mfa-recoveries/r1/review": {
        body: { reviewed: true, approved: true, delivery: "SENT" },
      },
    })
    await mfaRecoveryApi.review("r1", { ...reauth, approve: true, note: "Confirmei por telefone" })
    expect(api.find("POST", "/admin/mfa-recoveries/r1/review")[0].body).toEqual({
      ...reauth,
      approve: true,
      note: "Confirmei por telefone",
    })
  })

  it("sessões próprias: listar, encerrar uma e encerrar as outras", async () => {
    const api = fakeApi({
      "GET /admin/sessions": {
        body: { items: [{ id: "s1", current: true }], total: 1 },
      },
      "DELETE /admin/sessions/s2": { body: { revoked: 1 } },
      "POST /admin/sessions/revoke-others": { body: { revoked: 2 } },
    })
    await sessionsApi.mine()
    await sessionsApi.revoke("s2")
    await expect(sessionsApi.revokeOthers()).resolves.toEqual({ revoked: 2 })
    expect(api.find("DELETE", "/admin/sessions/s2")).toHaveLength(1)
    expect(api.find("GET", "/admin/sessions")[0].headers.get("x-csrf-token")).toBeNull()
  })
})
