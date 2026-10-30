import type { LucideIcon } from 'lucide-react-native';
import { Check, ChevronDown, X } from 'lucide-react-native';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, fonts, maxContentWidth, radius } from '../theme';

type Option = { value: string; label: string };
type Props = {
  label: string;
  placeholder: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  icon: LucideIcon;
  iconColor?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  error?: string;
  presentation?: 'modal' | 'dropdown';
};

export function SelectionField({
  label,
  placeholder,
  value,
  options,
  onChange,
  icon: Icon,
  iconColor,
  hideLabel,
  disabled,
  error,
  presentation = 'modal',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [focusedOption, setFocusedOption] = useState<string | null>(null);
  const expanded = open && !disabled;
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    option.label
      .toLocaleLowerCase('pt-BR')
      .includes(query.trim().toLocaleLowerCase('pt-BR')),
  );

  function renderOption(option: Option) {
    return (
      <Pressable
        key={option.value}
        accessibilityRole="radio"
        accessibilityLabel={option.label}
        accessibilityState={{ checked: option.value === value }}
        onFocus={() => setFocusedOption(option.value)}
        onBlur={() => setFocusedOption(null)}
        onPress={() => {
          onChange(option.value);
          setOpen(false);
          setFocusedOption(null);
        }}
        style={({ pressed }) => [
          styles.option,
          presentation === 'dropdown' &&
            option.value === value &&
            styles.selectedOption,
          focusedOption === option.value && styles.selectedOption,
          pressed && styles.dimmed,
        ]}
      >
        <Text style={styles.value}>{option.label}</Text>
        {option.value === value ? (
          <Check color={colors.accentDark} size={20} />
        ) : null}
      </Pressable>
    );
  }
  return (
    <View style={styles.field}>
      {!hideLabel ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityState={{ disabled: !!disabled, expanded }}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
        style={({ pressed }) => [
          styles.box,
          focused && styles.focused,
          expanded && styles.focused,
          !!error && styles.invalid,
          (disabled || pressed) && styles.dimmed,
        ]}
      >
        <Icon size={16} color={iconColor ?? colors.muted} fill={iconColor} />
        <Text
          numberOfLines={1}
          style={[styles.value, !selected && styles.placeholder]}
        >
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown
          size={14}
          color={colors.muted}
          style={expanded ? styles.chevronOpen : undefined}
        />
      </Pressable>
      {presentation === 'dropdown' && expanded ? (
        <View
          style={styles.dropdown}
          accessibilityRole="radiogroup"
          accessibilityLabel={label}
        >
          {options.map(renderOption)}
        </View>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Modal
        visible={presentation === 'modal' && expanded}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.dialog} accessibilityViewIsModal>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>
                {label}
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Fechar seleção"
                style={styles.close}
              >
                <X color={colors.primary} size={20} />
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel={`Buscar ${label.toLowerCase()}`}
              placeholder="Buscar..."
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              style={styles.search}
            />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.options}
            >
              {filtered.map(renderOption)}
              {!filtered.length ? (
                <Text style={styles.empty}>Nenhuma opção encontrada.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.inputBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  focused: { borderColor: colors.accentDark },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  dropdown: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  selectedOption: { backgroundColor: colors.accentBg },
  invalid: { borderColor: colors.destructive },
  dimmed: { opacity: 0.6 },
  value: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.foreground,
  },
  placeholder: { color: colors.muted },
  error: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.destructive,
  },
  overlay: {
    flex: 1,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: maxContentWidth,
    maxHeight: '80%',
    backgroundColor: colors.white,
    padding: 20,
    borderRadius: radius,
    gap: 16,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: {
    flex: 1,
    fontFamily: fonts.bold,
    color: colors.primary,
    fontSize: 18,
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: 12,
    fontFamily: fonts.regular,
    color: colors.foreground,
    fontSize: 14,
  },
  options: { flexGrow: 0 },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  empty: {
    fontFamily: fonts.regular,
    color: colors.muted,
    paddingVertical: 16,
  },
});
