import { useMemo } from 'react';

// O maplibre decodifica os tiles vetoriais num Web Worker, e dentro de um
// iframe `srcDoc` ele não consegue criar esse worker: o style, o TileJSON e os
// sprites respondem 200, nenhum tile chega a ser pedido e sobra o fundo vazio
// com os marcadores por cima. Servindo o mesmo HTML por uma blob URL o
// documento ganha uma origem própria e o worker passa a funcionar.
//
// A URL não é revogada: `onLoad` dispara já no `about:blank` inicial do iframe
// e a limpeza do efeito corre junto com a troca de `src`, então revogar em
// qualquer um dos dois mata o documento antes de ele abrir — o iframe fica em
// branco. São poucos bytes por rota exibida, liberados ao fechar a página.
export function MapDocument({ html }: { html: string }) {
  const url = useMemo(
    () => URL.createObjectURL(new Blob([html], { type: 'text/html' })),
    [html],
  );

  return (
    <iframe
      title="Mapa do trajeto da carona"
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      src={url}
      style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
    />
  );
}
