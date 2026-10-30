import {
  BookOpen,
  CarFront,
  Star,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, fonts } from '../theme';
import type { Achievement } from '../services/profileService';

const icons = {
  profile: BookOpen,
  car: CarFront,
  passenger: UserRound,
  users: Users,
  trophy: Trophy,
  star: Star,
};

export function AchievementCard({ item }: { item: Achievement }) {
  const Icon = icons[item.icon];
  return (
    <Card style={styles.card}>
      <View accessible accessibilityLabel={item.title} style={styles.content}>
        <View style={styles.icon}>
          <Icon size={24} color={colors.accentDark} />
        </View>
        <Text style={styles.title}>{item.title}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '47%',
    maxWidth: 180,
    minHeight: 140,
    padding: 16,
    justifyContent: 'center',
  },
  content: { gap: 12, alignItems: 'center' },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentBg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.primary,
    textAlign: 'center',
  },
});
