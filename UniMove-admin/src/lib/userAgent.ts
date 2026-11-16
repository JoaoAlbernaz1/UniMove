/**
 * Leitura do user agent guardado com a sessão.
 *
 * O servidor guarda só a cadeia bruta: não há telemetria de dispositivo, nem
 * localização. O que não dá para afirmar daqui volta como `null`, e a tela
 * mostra um travessão — inventar "MacBook Pro" seria dado fictício.
 */
export type SessionDevice = {
  /** Sistema reconhecido, ou null. */
  platform: string | null
  /** Navegador reconhecido, ou null. */
  browser: string | null
  /** Celular ou tablet, pelo que a cadeia declara. */
  handheld: boolean
}

const PLATFORMS: [RegExp, string][] = [
  [/Windows NT/i, "Windows"],
  [/iPhone/i, "iPhone"],
  [/iPad/i, "iPad"],
  [/Android/i, "Android"],
  [/Mac OS X|Macintosh/i, "macOS"],
  [/CrOS/i, "ChromeOS"],
  [/Linux/i, "Linux"],
]

// Ordem importa: Edge e Opera também se dizem Chrome, e Chrome também diz Safari.
const BROWSERS: [RegExp, string][] = [
  [/Edg\//i, "Edge"],
  [/OPR\/|Opera/i, "Opera"],
  [/SamsungBrowser/i, "Samsung Internet"],
  [/Firefox\//i, "Firefox"],
  [/Chrome\//i, "Chrome"],
  [/Safari\//i, "Safari"],
]

export function readSessionDevice(userAgent: string | null): SessionDevice {
  if (!userAgent) return { platform: null, browser: null, handheld: false }
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null
  return {
    platform,
    browser,
    handheld: /iPhone|iPad|Android|Mobile/i.test(userAgent),
  }
}

/** Texto curto para a coluna de dispositivo. */
export function describeDevice(userAgent: string | null) {
  const { platform, browser } = readSessionDevice(userAgent)
  if (!platform && !browser) return "Dispositivo não identificado"
  return [platform, browser].filter(Boolean).join(" • ")
}
