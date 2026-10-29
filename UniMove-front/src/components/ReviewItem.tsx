import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, fonts } from '../theme';
import type { ProfileReview } from '../services/profileService';

export function ReviewItem({ item }: { item: ProfileReview }) {
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{item.initials}</Text></View>
        <View>
          <Text style={styles.name}>{item.reviewerName}</Text>
          <Text style={styles.stars}>{'★'.repeat(item.score)}<Text style={styles.gray}>{'★'.repeat(5 - item.score)}</Text></Text>
        </View>
        <Text style={styles.date}>{item.date}</Text>
      </View>
      <Text style={styles.comment}>{item.comment}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { fontFamily: fonts.bold, color: colors.white },
  name: { fontFamily: fonts.bold, fontSize: 13, color: colors.primary },
  stars: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1, color: colors.accent },
  gray: { color: '#CBD5E1' },
  date: { marginLeft: 'auto', alignSelf: 'flex-start', fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  comment: { marginTop: 10, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
});
