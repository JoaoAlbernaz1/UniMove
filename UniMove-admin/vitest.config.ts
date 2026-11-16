import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://panel.test/" } },
    restoreMocks: true,
    setupFiles: ["./src/test/setup.ts"],
    // Precisa ser maior que o asyncUtilTimeout de setup.ts: a primeira importação das
    // páginas com gráfico é lenta, e o teste não pode expirar antes da própria espera.
    testTimeout: 30000,
  },
})
