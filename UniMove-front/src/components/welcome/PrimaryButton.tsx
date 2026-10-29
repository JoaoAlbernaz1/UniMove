import { ArrowRight, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, Pressable } from 'react-native';
import { colors, fonts, radius } from '../../theme';

export function PrimaryButton({ title, onPress, icon: Icon = ArrowRight }: { title: string; onPress: () => void; icon?: LucideIcon }) {
  return (
    <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <Text style={styles.text}>{title}</Text>
      <Icon size={20} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { height: 56, borderRadius: radius, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pressed: { opacity: 0.85 },
  text: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
});
