import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

type Props = { label: string; removable?: boolean; onRemove?: () => void };

export function TagChip({ label, removable, onRemove }: Props) {
  const content = <Text style={styles.text}>{label}</Text>;
  return removable ? (
    <Pressable style={styles.chip} onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remover tag ${label}`}>
      {content}<Text style={styles.remove}> ×</Text>
    </Pressable>
  ) : <View style={styles.chip}>{content}</View>;
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  text: { fontFamily: fonts.medium, fontSize: 12, color: colors.primary },
  remove: { fontFamily: fonts.bold, fontSize: 14, color: colors.muted },
});
