import { createContext, useContext } from "react"
import type { Page } from "../hooks/useRoute"
import type { ApiError } from "../services/http"
import type { DashboardSummary } from "../types/api"

export type ToastInput = { message: string; type?: "success" | "error" }

type AdminContextValue = {
  showToast: (toast: ToastInput) => void
  navigate: (page: Page, search?: Record<string, string>) => void
  search: URLSearchParams
  /** Grava filtros na URL sem criar entrada no histórico. Valor vazio remove a chave. */
  updateSearch: (patch: Record<string, string>) => void
  summary?: DashboardSummary
  summaryError?: ApiError
  /** Atualiza contadores do menu depois de uma decisão confirmada pelo backend. */
  refreshSummary: () => void
}

export const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin() {
  const value = useContext(AdminContext)
  if (!value) throw new Error("useAdmin precisa estar dentro de AdminLayout")
  return value
}
