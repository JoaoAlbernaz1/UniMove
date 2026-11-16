import { createContext, type ReactNode, useContext, useEffect, useState } from "react"

type Preferences = {
  textSize: "standard" | "large"
  compactTables: boolean
  sidebarCollapsed: boolean
}

const STORAGE_KEY = "unicarona-admin:preferences:v1"
const defaults: Preferences = {
  textSize: "standard",
  compactTables: false,
  sidebarCollapsed: false,
}

function readPreferences(): { preferences: Preferences; savedLocally: boolean } {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    const stored = value && typeof value === "object" ? value as Partial<Preferences> : {}
    return {
      preferences: {
        textSize: stored.textSize === "large" ? "large" : "standard",
        compactTables: stored.compactTables === true,
        sidebarCollapsed: stored.sidebarCollapsed === true,
      },
      savedLocally: true,
    }
  } catch {
    return { preferences: defaults, savedLocally: false }
  }
}

type PreferencesValue = ReturnType<typeof readPreferences> & {
  updatePreferences: (patch: Partial<Preferences>) => void
  resetPreferences: () => void
}

const PreferencesContext = createContext<PreferencesValue | null>(null)

/** Guarda somente opções visuais. Identidade e sessão continuam sendo responsabilidade da API. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readPreferences)

  useEffect(() => {
    const root = document.documentElement
    const previous = root.style.getPropertyValue("--admin-text-scale")
    root.style.setProperty("--admin-text-scale", state.preferences.textSize === "large" ? "1.125" : "1")
    return () => {
      if (previous) root.style.setProperty("--admin-text-scale", previous)
      else root.style.removeProperty("--admin-text-scale")
    }
  }, [state.preferences.textSize])

  function updatePreferences(patch: Partial<Preferences>) {
    const preferences = { ...state.preferences, ...patch }
    let savedLocally = true
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    } catch {
      savedLocally = false
    }
    setState({ preferences, savedLocally })
  }

  return (
    <PreferencesContext.Provider value={{
      ...state,
      updatePreferences,
      resetPreferences: () => updatePreferences(defaults),
    }}>
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences() {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error("usePreferences precisa estar dentro de PreferencesProvider")
  return value
}
