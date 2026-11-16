import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "../services/http"

type QueryState<T> = {
  data?: T
  error?: ApiError
  loading: boolean
}

function asApiError(reason: unknown) {
  return reason instanceof ApiError
    ? reason
    : new ApiError("Não foi possível carregar os dados.", 0)
}

export function useQuery<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<QueryState<T>>({ loading: true })
  const latest = useRef(0)
  const stableLoad = useCallback(load, deps)

  const run = useCallback(async () => {
    const id = ++latest.current
    setState((current) => ({ ...current, error: undefined, loading: true }))
    try {
      const data = await stableLoad()
      // Filtro trocado no meio do caminho: resposta antiga não sobrescreve a nova.
      if (id === latest.current) setState({ data, loading: false })
    } catch (reason) {
      if (id === latest.current)
        setState({ error: asApiError(reason), loading: false })
    }
  }, [stableLoad])

  useEffect(() => {
    void run()
  }, [run])

  return { ...state, reload: run }
}
