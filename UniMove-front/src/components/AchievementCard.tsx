import { CarFront, Trophy } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, fonts } from '../theme';
import type { Achievement } from '../services/profileService';

export function AchievementCard({ item }: { item: Achievement }) {
  const trusted = item.type === 'trusted-driver';
  return (
    <Card style={styles.card}>
      <View style={[styles.icon, trusted ? styles.blue : styles.yellow]}>
        {trusted ? <CarFront size={24} color="#1D4ED8" /> : <Trophy size={24} color="#F59E0B" />}
      </View>
      <Text style={[styles.text, trusted && styles.green]}>{item.title}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: 145, height: 145, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  blue: { backgroundColor: '#DBEAFE' }, yellow: { backgroundColor: '#FEF3C7' },
  text: { textAlign: 'center', fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.primary },
  green: { color: colors.accentDark },
});
