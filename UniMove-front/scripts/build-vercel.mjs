import { spawnSync } from "node:child_process"
import { cpSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// A Vercel usa UniMove-front/ como raiz. Os arquivos do painel estão
// no mesmo repositório, em ../UniMove-admin/ (habilitar arquivos fora da raiz).
const frontDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const adminDir = resolve(frontDir, "..", "UniMove-admin")
if (!existsSync(join(adminDir, "package.json"))) {
  throw new Error("UniMove-admin indisponivel: ative 'Include files outside the root directory' na Vercel.")
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Falha na compilacao: ${command} ${args.join(" ")} (exit ${result.status})`)
  }
}

run("npx", ["expo", "export", "--platform", "web", "--output-dir", "dist"], frontDir)
run("npm", ["ci", "--include=dev"], adminDir)
// Vite gera assets com base em /admin/ sem alterar o deploy antigo do painel.
run("npm", ["run", "build", "--", "--base=/admin/"], adminDir)
cpSync(join(adminDir, "dist"), join(frontDir, "dist", "admin"), { recursive: true })
console.log("Site unificado: / (Expo) e /admin (React/Vite)")
