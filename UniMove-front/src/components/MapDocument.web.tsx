export function MapDocument({ html }: { html: string }) {
  return (
    <iframe
      title="Mapa do trajeto da carona"
      srcDoc={html}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
    />
  );
}
