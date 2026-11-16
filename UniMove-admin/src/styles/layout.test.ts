import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// O jsdom roda com uma URL http, então import.meta.url não serve para achar o arquivo.
const css = readFileSync(resolve(process.cwd(), "src/styles/components.css"), "utf8")

/** Recorta o conteúdo de cada regra condicional (@media ou @container) com o prelúdio dado. */
function blocos(regra: "media" | "container"): { prelude: string; corpo: string }[] {
  const encontrados: { prelude: string; corpo: string }[] = []
  const abertura = new RegExp(`@${regra}([^{]*)\\{`, "g")
  for (let match = abertura.exec(css); match; match = abertura.exec(css)) {
    let profundidade = 1
    let i = match.index + match[0].length
    while (i < css.length && profundidade > 0) {
      if (css[i] === "{") profundidade += 1
      if (css[i] === "}") profundidade -= 1
      i += 1
    }
    encontrados.push({ prelude: match[1].trim(), corpo: css.slice(match.index + match[0].length, i - 1) })
  }
  return encontrados
}

describe("tabela responsiva", () => {
  it("a tabela é o próprio container da consulta", () => {
    const regra = css.match(/\.table-scroll \{[^}]*\}/)?.[0] ?? ""
    expect(regra).toContain("container-type: inline-size")
    expect(regra).toContain("container-name: tabela")
  })

  /*
   * O corte é pela largura da tabela, não pela da janela: com o menu lateral fixo a
   * partir de 901px, uma janela de 1024px deixa menos espaço para a tabela do que uma
   * de 820px. Um @media voltaria a esconder a coluna de situação em uma das duas.
   */
  it("o modo em blocos vem de uma consulta de container, nunca de @media", () => {
    // A marca do modo em blocos: a tabela deixa de ser tabela e o cabeçalho sai da vista.
    const emContainer = blocos("container").filter(
      (b) => /\.data-table, \.data-table tbody[^{]*\{ display: block/.test(b.corpo) && b.corpo.includes(".data-table thead"),
    )
    expect(emContainer).toHaveLength(1)
    expect(emContainer[0].prelude).toContain("tabela")

    const emMedia = blocos("media").filter((b) => b.corpo.includes(".data-table"))
    expect(emMedia.map((b) => b.prelude)).toEqual([])
  })

  it("o cartão em duas ou mais colunas só vale entre o celular e a tabela", () => {
    const grade = blocos("container").find((b) => /tbody tr \{[^}]*display: grid/.test(b.corpo))
    expect(grade?.prelude).toMatch(/min-width: \d+px/)
    expect(grade?.prelude).toMatch(/max-width: \d+px/)
  })

  it("a coluna larga quebra linha na tabela e ocupa o cartão inteiro no bloco", () => {
    expect(css).toMatch(/\.data-table \.cell-wrap \{[^}]*white-space: normal/)
    const emBlocos = blocos("container").find((b) => b.corpo.includes("display: block"))
    expect(emBlocos?.corpo).toMatch(/\.cell-wrap \{ min-width: 0; \}/)
  })
})
