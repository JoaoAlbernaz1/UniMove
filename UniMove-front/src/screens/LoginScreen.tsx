import { ArrowRight, Car, Lock, Mail } from 'lucide-react-native';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { TextField } from '../components/TextField';
import { colors, fonts, maxContentWidth, radius } from '../theme';
import { emailError } from '../validation';

type Props = {
  onRegister: () => void;
};

// UC11 – Fazer Login.
export function LoginScreen({ onRegister }: Props) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      setLoading(false);
    }
  }

  // UC12 – Recuperar Senha ainda não tem tela.
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
              <TextField
                label="Email Universitário"
                icon={Mail}
                value={email}
                onChangeText={setEmail}
                placeholder="seu@email.universitario.br"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
                editable={!loading}
              />
              <TextField
                label="Senha"
                icon={Lock}
                password
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                editable={!loading}
              />
              <Pressable style={styles.forgot} onPress={comingSoon} accessibilityRole="button">
                <Text style={styles.link}>Esqueceu a senha?</Text>
              </Pressable>
            </View>

            {error ? (
              <View style={styles.feedback}>
                <Message tone="error">{error}</Message>
              </View>
            ) : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Button title="Entrar" icon={ArrowRight} onPress={handleSubmit} loading={loading} />

            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.dividerText}>ou</Text>
              <View style={styles.line} />
            </View>

            <Button title="Criar nova conta" variant="outline" onPress={onRegister} />

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
  forgot: { alignSelf: 'flex-end' },
  link: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.accent },
  feedback: { marginBottom: 16 },
  notice: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 16,
  },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 24 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  footer: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 16,
  },
});
