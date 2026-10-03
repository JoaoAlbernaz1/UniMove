import type { LucideIcon } from 'lucide-react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, fonts, radius } from '../theme';

type Props = TextInputProps & {
  label: string;
  icon?: LucideIcon;
  hint?: string;
  // Campo de senha: esconde o texto e mostra o botão de olho.
  password?: boolean;
};

export function TextField({ label, icon: Icon, hint, password, ...input }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.box}>
        {Icon ? <Icon size={20} color={colors.muted} /> : null}
        <TextInput
          style={styles.input}
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          secureTextEntry={password && !visible}
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
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.primary },
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
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted, paddingHorizontal: 8 },
});
