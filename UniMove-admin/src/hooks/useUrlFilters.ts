import { useCallback, useEffect, useState } from "react"
import { useAdmin } from "../layout/AdminContext"
import { useDebounced } from "./useDebounced"

/** Valores aceitos na URL: lista fechada, formato ou texto livre (null). */
export type FilterRule = readonly string[] | RegExp | null
export const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/

function isValid(value: string, rule: FilterRule) {
  if (!rule) return true
  return rule instanceof RegExp ? rule.test(value) : rule.includes(value)
}

/**
 * Filtros e página ficam na URL: recarregar, voltar e compartilhar o endereço mantêm a lista.
 * Um valor que a tela não conhece, digitado na URL, é ignorado em vez de virar erro da API.
 * As regras devem ser uma constante do módulo: o objeto precisa ser estável entre renderizações.
 */
export function useUrlFilters<K extends string>(rules: Record<K, FilterRule>) {
  const { search, updateSearch } = useAdmin()
  const keys = Object.keys(rules) as K[]

  const values = Object.fromEntries(
    keys.map((key) => {
      const value = search.get(key) ?? ""
      return [key, value && isValid(value, rules[key]) ? value : ""]
    }),
  ) as Record<K, string>
  const page = Math.max(1, Math.floor(Number(search.get("page"))) || 1)

  // Trocar filtro volta à primeira página na mesma atualização, sem um pedido a mais.
  const setFilters = useCallback(
    (patch: Partial<Record<K, string>>) =>
      updateSearch({ ...(patch as Record<string, string>), page: "" }),
    [updateSearch],
  )
  const setPage = useCallback(
    (next: number) => updateSearch({ page: next > 1 ? String(next) : "" }),
    [updateSearch],
  )
  const clearFilters = useCallback(
    () =>
      updateSearch(
        Object.fromEntries(
          [...Object.keys(rules), "page"].map((key) => [key, ""]),
        ),
      ),
    [updateSearch, rules],
  )

  return { values, page, setFilters, setPage, clearFilters }
}

/** Campo de busca: responde na hora e só grava na URL depois da pausa na digitação. */
export function useSearchField(
  committed: string,
  commit: (value: string) => void,
) {
  const [value, setValue] = useState(committed)
  const debounced = useDebounced(value)

  // A URL mudou por fora: busca do topo, "Limpar filtros" ou botão voltar.
  useEffect(() => {
    if (committed !== debounced) setValue(committed)
  }, [committed])

  useEffect(() => {
    if (debounced !== committed) commit(debounced)
  }, [debounced])

  return [value, setValue] as const
}
