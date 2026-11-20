import { PAGE_SIZE } from "../config"
import type {
  AdminUserDetail,
  AdminUserRow,
  AuditLogRow,
  DashboardSummary,
  IncidentDetail,
  IncidentRow,
  IncidentStatus,
  ListResult,
  LoginResult,
  ReportSummary,
  ReportType,
  RideDetail,
  RideRow,
  SecondFactorResult,
  SeriesPoint,
  SessionUser,
  StatusChangeResult,
  UserImpact,
  UserStatus,
  VerificationRow,
  VerificationStatus,
} from "../types/api"
import { request, requestBlob, requestPublic } from "./http"

type Params = Record<string, string | number | undefined>

function query(params: Params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ""
}

async function list<T>(path: string, params: Params, init?: RequestInit): Promise<ListResult<T>> {
  const { data, headers } = await request<T[]>(
    `${path}${query({ limit: PAGE_SIZE, ...params })}`,
    init,
  )
  const counts = headers.get("X-Status-Counts")
  return {
    items: data,
    total: Number(headers.get("X-Total-Count") ?? data.length),
    statusCounts: counts ? (JSON.parse(counts) as Record<string, number>) : {},
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

export const authApi = {
  login: (email: string, password: string) =>
    requestPublic<LoginResult>(
      "/admin/auth/login",
      json("POST", { email, password }),
    ),
  secondFactor: (code: string) =>
    requestPublic<SecondFactorResult>(
      "/admin/auth/two-factor",
      json("POST", { code }),
    ),
  session: async () =>
    (await request<SessionUser>("/admin/auth/session")).data,
  logout: () => requestPublic<void>("/admin/auth/logout", json("POST")),
}

export const dashboardApi = {
  summary: async () =>
    (await request<DashboardSummary>("/admin/dashboard/summary")).data,
  series: async (days: number) =>
    (await request<SeriesPoint[]>(`/admin/dashboard/series?days=${days}`)).data,
}

export const usersApi = {
  list: (params: Params) => list<AdminUserRow>("/admin/users", params),
  detail: async (id: string) =>
    (await request<AdminUserDetail>(`/admin/users/${id}`)).data,
  impact: async (id: string) =>
    (await request<UserImpact>(`/admin/users/${id}/impact`)).data,
  changeStatus: async (
    id: string,
    body: { status: UserStatus; reason: string; confirmImpact?: boolean },
  ) =>
    (
      await request<StatusChangeResult>(
        `/admin/users/${id}/status`,
        json("PATCH", body),
      )
    ).data,
}

export const verificationsApi = {
  list: (status: VerificationStatus, page: number, limit = PAGE_SIZE) =>
    list<VerificationRow>("/admin/academic-verifications", {
      status,
      page,
      limit,
    }),
  review: async (
    userId: string,
    body: { status: "APPROVED" | "REJECTED"; reviewNote?: string },
  ) =>
    (
      await request<VerificationRow>(
        `/admin/academic-verifications/${userId}`,
        json("PATCH", body),
      )
    ).data,
}

export const ridesApi = {
  list: (params: Params) => list<RideRow>("/admin/rides", params, { cache: "no-store" }),
  detail: async (id: string) =>
    (await request<RideDetail>(`/admin/rides/${id}`)).data,
}

export const incidentsApi = {
  list: (params: Params) => list<IncidentRow>("/admin/incidents", params),
  detail: async (id: string) =>
    (await request<IncidentDetail>(`/admin/incidents/${id}`)).data,
  update: async (
    id: string,
    body: { status: IncidentStatus; note?: string },
  ) =>
    (
      await request<{
        id: string
        status: IncidentStatus
        notificationDelivered: boolean
      }>(`/admin/incidents/${id}`, json("PATCH", body))
    ).data,
}

export const auditApi = {
  list: (params: Params) => list<AuditLogRow>("/admin/audit-logs", params),
}

export const reportsApi = {
  summary: async (days: number) =>
    (await request<ReportSummary>(`/admin/reports/summary?days=${days}`)).data,
  download: async (type: ReportType, days: number) => {
    const { blob, headers } = await requestBlob(
      `/admin/reports/${type}/export?days=${days}`,
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `unicarona-${type}-${days}-dias.csv`
    link.click()
    URL.revokeObjectURL(url)
    return { truncated: headers.get("X-Report-Truncated") === "true" }
  },
}
