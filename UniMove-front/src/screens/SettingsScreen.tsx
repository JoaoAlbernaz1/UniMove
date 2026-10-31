import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  CircleHelp,
  LogOut,
  Shield,
  ShieldCheck,
  UserRound,
} from 'lucide-react-native';
import type { Me } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { Message } from '../components/Message';
import { colors, fonts, maxContentWidth } from '../theme';

const settingsSections = [
  {
    title: 'CONTA',
    items: [
      { title: 'Informações Pessoais', icon: UserRound, color: colors.primary },
    ],
  },
  {
    title: 'PREFERÊNCIAS',
    items: [
      { title: 'Notificações', icon: Bell, color: colors.accent },
      { title: 'Privacidade', icon: Shield, color: colors.primary },
    ],
  },
  {
    title: 'SUPORTE',
    items: [
      { title: 'Central de Ajuda', icon: CircleHelp, color: colors.primary },
    ],
  },
];

export function SettingsScreen({
  onBack,
  onNavigatePersonalInfo,
  onNavigateAdminVerification,
}: {
  onBack: () => void;
  onNavigatePersonalInfo: () => void;
  onNavigateAdminVerification: () => void;
}) {
  const { authApi, signOut } = useAuth();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    setError(null);
    try {
      setUser(await authApi<Me>('/users/me'));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível carregar os dados da conta.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authApi]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadUser();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadUser]);

  function showComingSoon(moduleName: string) {
    Alert.alert(
      moduleName,
      'Este módulo será desenvolvido em uma próxima etapa.',
    );
  }

  function confirmSignOut() {
    Alert.alert('Sair da conta', 'Deseja realmente encerrar sua sessão?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: () => {
          void signOut().catch((reason: unknown) => {
            Alert.alert(
              'Não foi possível sair',
              reason instanceof Error ? reason.message : 'Tente novamente.',
            );
          });
        },
      },
    ]);
  }

  const fullName = user?.fullName.trim() || 'Usuário';
  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Pressable
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Voltar para a tela inicial"
          >
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Configurações</Text>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadUser();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {loading && !user ? (
          <View style={styles.identityState}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.stateText}>Carregando dados da conta...</Text>
          </View>
        ) : error && !user ? (
          <View style={styles.identityState}>
            <Message tone="error">{error}</Message>
            <Pressable
              onPress={() => {
                setLoading(true);
                void loadUser();
              }}
              style={styles.retryButton}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Tentar novamente</Text>
            </Pressable>
          </View>
        ) : user ? (
          <View style={styles.identityCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.identityCopy}>
              <Text style={styles.userName} numberOfLines={1}>
                {user.fullName}
              </Text>
              <Text style={styles.userEmail} numberOfLines={1}>
                {user.institutionalEmail}
              </Text>
            </View>
          </View>
        ) : null}
        {error && user ? (
          <View style={styles.refreshError}>
            <Message tone="error">{error}</Message>
          </View>
        ) : null}

        {settingsSections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.sectionCard}>
              {section.items.map((item, index) => {
                const Icon = item.icon;
                return (
                  <Pressable
                    key={item.title}
                    onPress={() =>
                      item.title === 'Informações Pessoais'
                        ? onNavigatePersonalInfo()
                        : showComingSoon(item.title)
                    }
                    style={({ pressed }) => [
                      styles.menuRow,
                      index < section.items.length - 1 && styles.dividedRow,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                  >
                    <Icon size={18} color={item.color} />
                    <Text style={styles.menuLabel}>{item.title}</Text>
                    <ChevronRight size={19} color={colors.muted} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        {user?.roles?.some(({ role }) => role.name === 'ADMIN') ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ADMINISTRAÇÃO</Text>
            <View style={styles.sectionCard}>
              <Pressable
                onPress={onNavigateAdminVerification}
                style={({ pressed }) => [
                  styles.menuRow,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <ShieldCheck size={18} color={colors.primary} />
                <Text style={styles.menuLabel}>Revisões cadastrais</Text>
                <ChevronRight size={19} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.versionCard}>
          <Text style={styles.versionName}>UniMove</Text>
          <Text style={styles.versionNumber}>Versão 1.0.0</Text>
        </View>

        <Pressable
          onPress={confirmSignOut}
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
        >
          <LogOut size={17} color={colors.destructive} />
          <Text style={styles.signOutLabel}>Sair da Conta</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary },
  headerContent: {
    width: '100%',
    maxWidth: maxContentWidth,
    minHeight: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backButton: {
    width: 42,
    height: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.white,
  },
  body: { flex: 1, backgroundColor: colors.background },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 28,
  },
  identityCard: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.white,
    marginBottom: 20,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  avatarText: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.white,
  },
  identityCopy: { flex: 1, minWidth: 0 },
  userName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary,
  },
  userEmail: {
    marginTop: 4,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.muted,
  },
  identityState: {
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.white,
    marginBottom: 20,
  },
  refreshError: { marginBottom: 16 },
  stateText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.muted,
  },
  retryButton: { paddingVertical: 4, paddingHorizontal: 8 },
  retryText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.accentDark,
  },
  section: { marginBottom: 20 },
  sectionTitle: {
    marginBottom: 9,
    paddingHorizontal: 6,
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 0.3,
    color: colors.muted,
  },
  sectionCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  menuRow: {
    minHeight: 47,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  dividedRow: { borderBottomWidth: 1, borderBottomColor: colors.border },
  menuLabel: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.primary,
  },
  versionCard: {
    minHeight: 66,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    marginTop: 2,
    marginBottom: 18,
  },
  versionName: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.primary,
  },
  versionNumber: {
    marginTop: 4,
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.muted,
  },
  signOutButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.destructive,
    borderRadius: 13,
    backgroundColor: colors.white,
  },
  signOutLabel: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.destructive,
  },
  pressed: { opacity: 0.82 },
});
