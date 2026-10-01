import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Me } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { Message } from '../components/Message';
import { colors, fonts, radius } from '../theme';

// Tela provisória: só confirma que o login funcionou de ponta a ponta.
export function HomeScreen() {
  const { authApi, signOut, justRegistered } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authApi<Me>('/users/me')
      .then(setMe)
      .catch((e: Error) => setError(e.message));
  }, [authApi]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        {justRegistered ? (
          <View style={styles.banner}>
            <Message tone="success">Cadastro realizado com sucesso!</Message>
          </View>
        ) : null}
        {me ? (
          <>
            <Text style={styles.title}>Olá, {me.fullName.split(' ')[0]}!</Text>
            <Text style={styles.subtitle}>{me.institutionalEmail}</Text>
          </>
        ) : error ? (
          <Text style={styles.subtitle}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
        <Pressable style={styles.button} onPress={signOut} accessibilityRole="button">
          <Text style={styles.buttonText}>Sair</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  banner: { alignSelf: 'stretch', marginBottom: 16 },
  title: { fontFamily: fonts.bold, fontSize: 24, color: colors.primary },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  button: {
    marginTop: 24,
    height: 48,
    paddingHorizontal: 32,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontFamily: fonts.medium, fontSize: 14, color: colors.primary },
});
