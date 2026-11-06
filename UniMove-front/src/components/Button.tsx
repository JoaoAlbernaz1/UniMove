import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts, radius } from '../theme';
import { NotificationDot } from './NotificationDot';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'accent' | 'destructive-outline';
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  notificationDot?: boolean;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon: Icon,
  loading,
  disabled,
  notificationDot = false,
}: Props) {
  const destructive = variant === 'destructive-outline';
  const primary = variant !== 'outline' && !destructive;
  const inactive = loading || disabled;
  const contentColor = destructive ? colors.destructive : primary ? colors.white : colors.accent;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        variant === 'accent'
          ? styles.accent
          : primary
            ? styles.primary
            : styles.outline,
        pressed && styles.pressed,
        inactive && styles.inactive,
        destructive && !primary && styles.destructiveOutline,
      ]}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={notificationDot ? `${title}. Há novidades pendentes.` : title}
      accessibilityState={{ busy: !!loading, disabled: !!inactive }}
    >
      {loading ? (
        <ActivityIndicator color={contentColor} />
      ) : (
        <>
          <Text style={[primary ? styles.primaryText : styles.outlineText, destructive && styles.destructiveText]}>
            {title}
          </Text>
          {Icon ? (
            <Icon size={20} color={contentColor} />
          ) : null}
        </>
      )}
      {notificationDot ? <NotificationDot /> : null}
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
  accent: { backgroundColor: colors.accent },
  outline: { borderWidth: 2, borderColor: colors.accent },
  destructiveOutline: { borderColor: colors.destructive },
  destructiveText: { color: colors.destructive },
  pressed: { opacity: 0.85 },
  inactive: { opacity: 0.5 },
  primaryText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 24,
    color: colors.white,
  },
  outlineText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.accent,
  },
});
