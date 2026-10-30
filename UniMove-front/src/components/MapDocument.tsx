import { WebView } from 'react-native-webview';

// Implementação usada no Android/iOS; o Metro seleciona .web.tsx no navegador.
export function MapDocument({ html }: { html: string }) {
  return (
    <WebView
      source={{ html }}
      style={{ flex: 1 }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
    />
  );
}
