type CsvCell = string | number | null | undefined;

const BOM = String.fromCharCode(0xfeff);

// Planilhas executam células que começam com estes caracteres, e parte do conteúdo
// (nome, curso) é digitada pelo próprio usuário.
const FORMULA_PREFIX = /^[=+\-@\t\r\n]/;

function escapeCell(value: CsvCell) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const safe = typeof value === 'string' && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** `;` e BOM: é o que o Excel em pt-BR abre sem assistente de importação. */
export function toCsv(headers: string[], rows: CsvCell[][]) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
