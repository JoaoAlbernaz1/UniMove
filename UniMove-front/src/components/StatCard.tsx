import { CalendarDays, MapPin, Star } from 'lucide-react-native';
import { StyleSheet, Text } from 'react-native';
import { Card } from './Card';
import { colors, fonts } from '../theme';
import type { ProfileStats } from '../services/profileService';

export function StatCard({ item }: { item: ProfileStats }) {
  const Icon = item.icon === 'calendar' ? CalendarDays : item.icon === 'star' ? Star : MapPin;
  return (
    <Card style={styles.card}>
      <Icon size={20} color={colors.accent} />
      <Text style={styles.value}>{item.value}</Text>
      <Text style={styles.label}>{item.label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, height: 118, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  value: { marginTop: 5, fontFamily: fonts.bold, fontSize: 21, color: colors.primary },
  label: { marginTop: 2, textAlign: 'center', fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
});
