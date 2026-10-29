import type { LucideIcon } from 'lucide-react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { colors, fonts, radius } from '../theme';

type Props = TextInputProps & {
  label: string;
  icon?: LucideIcon;
  hint?: string;
  // Campo de senha: esconde o texto e mostra o botão de olho.
  password?: boolean;
  hideLabel?: boolean;
  error?: string;
  prefix?: string;
  iconColor?: string;
};

export function TextField({
  label,
  icon: Icon,
  hint,
  password,
  hideLabel,
  error,
  prefix,
  iconColor,
  style,
  onFocus,
  onBlur,
  ...input
}: Props) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      {!hideLabel ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.box,
          input.multiline && styles.multiline,
          focused && styles.focused,
          !!error && styles.invalid,
        ]}
      >
        {Icon ? <Icon size={20} color={iconColor ?? colors.muted} /> : null}
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          style={[
            styles.input,
            input.multiline && styles.multilineInput,
            style,
          ]}
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          secureTextEntry={password && !visible}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...input}
        />
        {password ? (
          <Pressable
            onPress={() => setVisible((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Esconder senha' : 'Mostrar senha'}
          >
            {visible ? (
              <EyeOff size={20} color={colors.muted} />
            ) : (
              <Eye size={20} color={colors.muted} />
            )}
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.primary,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
  },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.foreground,
    // Tira o contorno azul padrão do navegador no web.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  focused: { borderColor: colors.accentDark },
  invalid: { borderColor: colors.destructive },
  multiline: { alignItems: 'flex-start', minHeight: 96 },
  multilineInput: { minHeight: 70, textAlignVertical: 'top' },
  prefix: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  error: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.destructive,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
    paddingHorizontal: 8,
  },
});
