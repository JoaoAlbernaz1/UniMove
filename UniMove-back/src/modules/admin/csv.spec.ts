import { toCsv } from './csv';

describe('toCsv', () => {
  it('usa BOM, ponto e vírgula e CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a;b\r\n1;x\r\n');
  });

  it('escapa aspas, separador e quebra de linha', () => {
    const csv = toCsv(['a'], [['com "aspas"'], ['com;ponto'], ['com\nlinha']]);
    expect(csv).toContain('"com ""aspas"""');
    expect(csv).toContain('"com;ponto"');
    expect(csv).toContain('"com\nlinha"');
  });

  it.each(['=1+1', '+1', '-1', '@soma', '\tx', '\rx', '\nx'])(
    'neutraliza fórmula em %j',
    (value) => {
      expect(toCsv(['a'], [[value]])).toContain(`'${value}`);
    },
  );

  it('não altera números negativos e deixa vazio o que não existe', () => {
    expect(toCsv(['a', 'b', 'c'], [[-5, null, undefined]])).toContain('-5;;\r\n');
  });
});
