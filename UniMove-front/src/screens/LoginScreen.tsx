import { AlertCircle, ArrowRight, Car, Eye, EyeOff, Lock, Mail } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { ALLOWED_EMAIL_DOMAINS } from '../config';
import { colors, fonts, maxContentWidth, radius } from '../theme';

const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

// Mensagem da especificação de casos de uso (UC01 A02 / RN04).
const INSTITUTIONAL_EMAIL_ERROR =
  'O e-mail informado não é um e-mail institucional válido. Utilize seu e-mail acadêmico.';

function emailError(email: string) {
  const match = EMAIL_PATTERN.exec(email.trim().toLowerCase());
  if (!match) return 'Digite um e-mail universitário válido.';
  if (!ALLOWED_EMAIL_DOMAINS.includes(match[1])) return INSTITUTIONAL_EMAIL_ERROR;
  return null;
}

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit() {
    setNotice(null);
    const invalidEmail = emailError(email);
    if (invalidEmail) {
      setError(invalidEmail);
      return;
    }
    if (!password) {
      setError('Digite sua senha.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  function comingSoon() {
    setError(null);
    setNotice('Essa função ainda está em construção.');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <View style={styles.brand}>
              <View style={styles.logo}>
                <Car size={32} color={colors.accent} strokeWidth={1.5} />
              </View>
              <Text style={styles.brandName}>UniMove</Text>
              <Text style={styles.brandTagline}>Caronas universitárias seguras</Text>
            </View>

            <View style={styles.heading}>
              <Text style={styles.title}>Bem-vindo de volta!</Text>
              <Text style={styles.subtitle}>Entre com sua conta universitária</Text>
            </View>

            <View style={styles.fields}>
              <View style={styles.field}>
                <Text style={styles.label}>Email Universitário</Text>
                <View style={styles.inputBox}>
                  <Mail size={20} color={colors.muted} />
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    accessibilityLabel="Email Universitário"
                    placeholder="seu@email.universitario.br"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    returnKeyType="next"
                    editable={!loading}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Senha</Text>
                <View style={styles.inputBox}>
                  <Lock size={20} color={colors.muted} />
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    accessibilityLabel="Senha"
                    placeholder="••••••••"
                    placeholderTextColor={colors.muted}
                    secureTextEntry={!showPassword}
                    autoComplete="password"
                    textContentType="password"
                    returnKeyType="go"
                    onSubmitEditing={handleSubmit}
                    editable={!loading}
                  />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                  >
                    {showPassword ? (
                      <EyeOff size={20} color={colors.muted} />
                    ) : (
                      <Eye size={20} color={colors.muted} />
                    )}
                  </Pressable>
                </View>
              </View>

              <Pressable style={styles.forgot} onPress={comingSoon} accessibilityRole="button">
                <Text style={styles.link}>Esqueceu a senha?</Text>
              </Pressable>
            </View>

            {error ? (
              <View style={styles.errorBox} accessibilityLiveRegion="polite">
                <AlertCircle size={18} color={colors.destructive} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.primary, (pressed || loading) && styles.pressed]}
              onPress={handleSubmit}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Entrar"
              accessibilityState={{ busy: loading }}
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Text style={styles.primaryText}>Entrar</Text>
                  <ArrowRight size={20} color={colors.white} />
                </>
              )}
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.dividerText}>ou</Text>
              <View style={styles.line} />
            </View>

            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={comingSoon}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Criar nova conta</Text>
            </Pressable>

            <Text style={styles.footer}>
              Primeira vez? Cadastre-se e comece a compartilhar caronas.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32 },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  brand: { alignItems: 'center', paddingTop: 56, paddingBottom: 40 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  brandName: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 32, color: colors.primary },
  brandTagline: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 4 },
  heading: { marginBottom: 24 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 32, color: colors.primary, marginBottom: 4 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.muted },
  fields: { gap: 16, marginBottom: 24 },
  field: { gap: 8 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.primary },
  inputBox: {
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
  forgot: { alignSelf: 'flex-end' },
  link: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.accent },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.destructiveBg,
    marginBottom: 16,
  },
  errorText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.destructive },
  notice: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 16,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    paddingVertical: 16,
    borderRadius: radius,
    backgroundColor: colors.primary,
  },
  primaryText: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, color: colors.white },
  pressed: { opacity: 0.85 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 24 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  secondaryText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.accent },
  footer: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 16,
  },
});
