import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts, radius } from '../theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'outline';
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ title, onPress, variant = 'primary', icon: Icon, loading, disabled }: Props) {
  const primary = variant === 'primary';
  const inactive = loading || disabled;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.outline,
        pressed && styles.pressed,
        inactive && styles.inactive,
      ]}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: !!loading, disabled: !!inactive }}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.white : colors.accent} />
      ) : (
        <>
          <Text style={primary ? styles.primaryText : styles.outlineText}>{title}</Text>
          {Icon ? <Icon size={20} color={primary ? colors.white : colors.accent} /> : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    paddingVertical: 16,
    borderRadius: radius,
  },
  primary: { backgroundColor: colors.primary },
  outline: { borderWidth: 2, borderColor: colors.accent },
  pressed: { opacity: 0.85 },
  inactive: { opacity: 0.5 },
  primaryText: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, color: colors.white },
  outlineText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.accent },
});
