import { AlertCircle, CheckCircle2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

type Props = {
  tone: 'error' | 'success';
  children: ReactNode;
};

// Caixa de aviso abaixo do formulário. Lida pelo leitor de tela quando aparece.
export function Message({ tone, children }: Props) {
  const error = tone === 'error';
  const Icon = error ? AlertCircle : CheckCircle2;
  const color = error ? colors.destructive : colors.accentDark;

  return (
    <View
      style={[styles.box, { backgroundColor: error ? colors.destructiveBg : colors.accentBg }]}
      accessibilityLiveRegion="polite"
    >
      <Icon size={18} color={color} />
      <Text style={[styles.text, { color }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12 },
  text: { flex: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
});
