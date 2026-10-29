import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../../theme';

export function BenefitCard({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <View style={styles.card}>
      <View style={styles.icon}><Icon size={24} color={colors.accent} strokeWidth={1.8} /></View>
      <View style={styles.copy}><Text style={styles.title}>{title}</Text><Text style={styles.description}>{description}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', minHeight: 118, paddingHorizontal: 18, paddingVertical: 16, backgroundColor: colors.white, borderRadius: radius, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E7F8EE', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  copy: { flex: 1 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 23, color: colors.primary },
  description: { marginTop: 4, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
});
