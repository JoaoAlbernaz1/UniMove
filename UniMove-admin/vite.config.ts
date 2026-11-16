import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// Removidos os plugins exclusivos do Figma Make (site.json, overlay, kit e
// sourcemaps de pacotes vinculados): dependiam de ./.figma, que não existe fora
// da plataforma.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      // O navegador só fala com a própria origem do painel, como em produção
      // (vercel.json). Assim os cookies de sessão são de primeira parte.
      proxy: {
        "/api": {
          target: env.VITE_DEV_API_PROXY_TARGET || "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap: false,
    },
  }
})
