import { ArrowLeft, Check, Circle, IdCard, Lock, Mail, User } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountCreatedError, useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { TextField } from '../components/TextField';
import { ALLOWED_EMAIL_DOMAINS } from '../config';
import { colors, fonts, maxContentWidth } from '../theme';
import {
  emailError,
  formatCpf,
  isStrongPassword,
  isValidCpf,
  onlyDigits,
  PASSWORD_RULES,
} from '../validation';

type Props = {
  onBack: () => void;
};

// UC01 – Cadastrar Usuário, tela I01. Por enquanto sem as etapas de código por
// e-mail e reconhecimento facial, que o backend ainda não tem.
export function RegisterScreen({ onBack }: Props) {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A01: conta já existe (ou acabou de ser criada) — oferece voltar ao login.
  const [offerLogin, setOfferLogin] = useState(false);

  // I01 comando 2: "Voltar" sempre habilitado, inclusive pelo botão do Android.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  // A mensagem fica abaixo do formulário; rola até ela para não passar despercebida.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (error) scrollRef.current?.scrollToEnd({ animated: true });
  }, [error]);

  // I01 comando 1: habilitado quando todos os campos obrigatórios (RN01) estão preenchidos.
  const filled = [fullName, cpf, email, password, confirmation].every((value) => value.trim());

  function validate() {
    if (fullName.trim().length < 3) return 'Digite seu nome completo.';
    if (!isValidCpf(cpf)) return 'CPF inválido. Confira os 11 dígitos.';
    const invalidEmail = emailError(email);
    if (invalidEmail) return invalidEmail;
    if (!isStrongPassword(password)) return 'A senha não atende aos requisitos abaixo do campo.';
    if (password !== confirmation) return 'A confirmação precisa ser idêntica à senha.';
    return null;
  }

  async function handleSubmit() {
    setOfferLogin(false);
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signUp({
        fullName: fullName.trim(),
        cpf: onlyDigits(cpf),
        institutionalEmail: email.trim().toLowerCase(),
        password,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.';
      setError(message);
      setOfferLogin(e instanceof AccountCreatedError || message.includes('já cadastrado'));
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            <Pressable
              style={styles.back}
              onPress={onBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Voltar ao login"
            >
              <ArrowLeft size={24} color={colors.primary} />
            </Pressable>

            <View style={styles.heading}>
              <Text style={styles.title}>Criar conta</Text>
              <Text style={styles.subtitle}>Junte-se à comunidade universitária de caronas</Text>
            </View>

            <View style={styles.fields}>
              <TextField
                label="Nome Completo"
                icon={User}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Seu nome completo"
                maxLength={100}
                autoComplete="name"
                textContentType="name"
                autoCapitalize="words"
                editable={!loading}
              />
              <TextField
                label="CPF"
                icon={IdCard}
                value={cpf}
                onChangeText={(value) => setCpf(formatCpf(value))}
                placeholder="000.000.000-00"
                keyboardType="number-pad"
                maxLength={14}
                editable={!loading}
              />
              <TextField
                label="Email Universitário"
                icon={Mail}
                value={email}
                onChangeText={setEmail}
                placeholder="seu@email.universitario.br"
                hint={`Use seu e-mail institucional (@${ALLOWED_EMAIL_DOMAINS.join(', @')})`}
                maxLength={150}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                editable={!loading}
              />
              <View style={styles.passwordGroup}>
                <TextField
                  label="Senha"
                  icon={Lock}
                  password
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Mínimo 8 caracteres"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  editable={!loading}
                />
                <View style={styles.rules} accessibilityLabel="Requisitos da senha">
                  {PASSWORD_RULES.map((rule) => {
                    const ok = rule.test(password);
                    return (
                      <View key={rule.label} style={styles.rule}>
                        {ok ? (
                          <Check size={14} color={colors.accentDark} />
                        ) : (
                          <Circle size={14} color={colors.muted} />
                        )}
                        <Text style={[styles.ruleText, ok && styles.ruleOk]}>{rule.label}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
              <TextField
                label="Confirmar Senha"
                icon={Lock}
                password
                value={confirmation}
                onChangeText={setConfirmation}
                placeholder="Confirme sua senha"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={filled ? handleSubmit : undefined}
                editable={!loading}
              />
            </View>

            {error ? (
              <View style={styles.feedback}>
                <Message tone="error">{error}</Message>
                {offerLogin ? (
                  <Pressable onPress={onBack} accessibilityRole="button" style={styles.toLogin}>
                    <Text style={styles.link}>Voltar ao login</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.content}>
            <Button title="Criar conta" onPress={handleSubmit} loading={loading} disabled={!filled} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 24 },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingTop: 48, paddingBottom: 24 },
  heading: { marginBottom: 32 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, color: colors.primary, marginBottom: 8 },
  subtitle: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.muted },
  fields: { gap: 16 },
  passwordGroup: { gap: 8 },
  rules: { gap: 4, paddingHorizontal: 8 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ruleText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  ruleOk: { color: colors.accentDark },
  feedback: { marginTop: 24, gap: 12 },
  toLogin: { alignSelf: 'center' },
  link: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.accent },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
});
