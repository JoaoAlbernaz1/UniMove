import { WebView } from 'react-native-webview';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

export type MapPoint = {
  latitude: number;
  longitude: number;
  label: string;
  kind?: 'origin' | 'destination';
};

type Props = { points: MapPoint[]; height?: number };

export function OpenFreeMap({ points, height = 300 }: Props) {
  if (!points.length) {
    return <View style={[styles.empty, { height }]}><Text style={styles.emptyText}>Coordenadas indisponíveis para esta rota.</Text></View>;
  }

  const validPoints = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!validPoints.length) return null;

  const center = validPoints.reduce((acc, point) => ({ latitude: acc.latitude + point.latitude / validPoints.length, longitude: acc.longitude + point.longitude / validPoints.length }), { latitude: 0, longitude: 0 });
  const data = JSON.stringify(validPoints).replace(/</g, '\\u003c');
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><script src="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js"></script><link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css"><style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden}.marker-origin,.marker-destination{width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35)}.marker-origin{background:#22c55e}.marker-destination{background:#101828}</style></head><body><div id="map"></div><script>const points=${data};const center=[${center.longitude},${center.latitude}];const map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/bright',center,zoom:11});map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');for(const point of points){const marker=document.createElement('div');marker.className=point.kind==='destination'?'marker-destination':'marker-origin';new maplibregl.Marker({element:marker}).setLngLat([point.longitude,point.latitude]).setPopup(new maplibregl.Popup({offset:10}).setText(point.label)).addTo(map);}if(points.length>1){const bounds=new maplibregl.LngLatBounds();points.forEach(point=>bounds.extend([point.longitude,point.latitude]));map.fitBounds(bounds,{padding:55,maxZoom:14});}</script></body></html>`;

  return <View style={[styles.map, { height }]}><WebView source={{ html }} style={styles.webview} originWhitelist={['*']} javaScriptEnabled domStorageEnabled scrollEnabled={false} /></View>;
}

const styles = StyleSheet.create({ map: { width: '100%', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }, webview: { flex: 1 }, empty: { width: '100%', borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', padding: 20 }, emptyText: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, textAlign: 'center' } });
