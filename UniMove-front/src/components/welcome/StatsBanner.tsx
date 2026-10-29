import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../../theme';

export function StatsBanner({ stats }: { stats: readonly { value: string; label: string }[] }) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.heading}>Junte-se a milhares de universitários</Text>
      <View style={styles.row}>
        {stats.map((stat, index) => (
          <View style={styles.stat} key={stat.label}>
            <Text style={[styles.value, index === 1 && styles.valueDark]}>{stat.value}</Text>
            <Text style={styles.label}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: colors.white, borderRadius: radius, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 18, marginBottom: 12 },
  heading: { textAlign: 'center', fontFamily: fonts.bold, fontSize: 13, color: colors.primary, marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { flex: 1, alignItems: 'center' },
  value: { fontFamily: fonts.bold, fontSize: 23, lineHeight: 28, color: colors.accent },
  valueDark: { color: colors.primary },
  label: { marginTop: 3, fontFamily: fonts.regular, fontSize: 11, color: colors.muted },
});
