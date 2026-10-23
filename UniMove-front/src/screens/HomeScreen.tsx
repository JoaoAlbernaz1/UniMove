import {
  Alert,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CarFront,
  ChevronRight,
  Clock3,
  LogOut,
  MapPin,
  MessageCircle,
  Settings,
  Users,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Me } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { Message } from '../components/Message';
import { colors, fonts, maxContentWidth, radius } from '../theme';

type HomeProfile = Me & {
  status: string;
  roles: { role: { name: string } }[];
};

type Ride = {
  id: string;
  departureAt: string;
  status: 'SCHEDULED' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  availableSeats: number;
  originLocation: { name: string };
  destinationLocation: { name: string };
  driver: { id: string; fullName: string };
  reservations: { passengerId: string; seats: number; status: string }[];
};

const statusLabels: Record<Ride['status'], string> = {
  SCHEDULED: 'Agendada',
  OPEN: 'Aberta',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};

// Aqui recebemos a função de navegação via props, no seu padrão
export function HomeScreen({ onNavigateSearch }: { onNavigateSearch?: () => void }) {
  const { authApi, signOut, justRegistered } = useAuth();
  const [me, setMe] = useState<HomeProfile | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [ridesError, setRidesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadHome = useCallback(async (pullToRefresh = false) => {
    if (pullToRefresh) setRefreshing(true);
    else setLoading(true);

    const [profileResult, ridesResult] = await Promise.allSettled([
      authApi<HomeProfile>('/users/me'),
      authApi<Ride[]>('/rides/me?limit=20'),
    ]);

    if (profileResult.status === 'fulfilled') {
      setMe(profileResult.value);
      setProfileError(null);
    } else {
      setProfileError(profileResult.reason instanceof Error
        ? profileResult.reason.message
        : 'Não foi possível carregar seus dados.');
    }

    if (ridesResult.status === 'fulfilled') {
      setRides(ridesResult.value);
      setRidesError(null);
    } else {
      setRidesError(ridesResult.reason instanceof Error
        ? ridesResult.reason.message
        : 'Não foi possível carregar suas caronas.');
    }

    setLoading(false);
    setRefreshing(false);
  }, [authApi]);

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  const upcomingRides = rides
    .filter((ride) =>
      (ride.status === 'OPEN' || ride.status === 'SCHEDULED') &&
      new Date(ride.departureAt).getTime() >= Date.now() &&
      (ride.driver.id === me?.id || ride.reservations.some((reservation) =>
        reservation.passengerId === me?.id && reservation.status === 'CONFIRMED',
      )),
    )
    .sort((a, b) => new Date(a.departureAt).getTime() - new Date(b.departureAt).getTime())
    .slice(0, 3);

  function showComingSoon(feature: string, description = 'Esta funcionalidade será disponibilizada em uma próxima etapa.') {
    Alert.alert(feature, description);
  }

  function confirmSignOut() {
    Alert.alert('Sair da conta', 'Deseja realmente encerrar sua sessão?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  const firstName = me?.fullName.trim().split(/\s+/)[0];
  const initials = me?.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadHome(true)}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={styles.page}>
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <View style={styles.greeting}>
                <Text style={styles.greetingLabel}>Olá,</Text>
                <Text style={styles.greetingName} numberOfLines={1}>
                  {firstName ?? 'boas-vindas'}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => showComingSoon('Notificações')}
                  style={styles.headerIconButton}
                  accessibilityRole="button"
                  accessibilityLabel="Notificações"
                >
                  <Bell size={20} color={colors.white} />
                </Pressable>
                <Pressable
                  onPress={confirmSignOut}
                  style={styles.avatar}
                  accessibilityRole="button"
                  accessibilityLabel="Sair da conta"
                >
                  {initials ? (
                    <Text style={styles.avatarText}>{initials}</Text>
                  ) : (
                    <LogOut size={18} color={colors.white} />
                  )}
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.content}>
            {justRegistered ? (
              <View style={styles.registrationNotice}>
                <Message tone="success">Cadastro realizado com sucesso!</Message>
              </View>
            ) : null}

            {profileError ? (
              <View style={styles.errorNotice}>
                <Message tone="error">{profileError}</Message>
                <Pressable onPress={() => void loadHome()} accessibilityRole="button">
                  <Text style={styles.retryText}>Tentar novamente</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.intro}>
              <View style={styles.introIcon}>
                <CarFront size={24} color={colors.accent} />
              </View>
              <View style={styles.introCopy}>
                <Text style={styles.introTitle}>Sua rotina, em movimento</Text>
                <Text style={styles.introSubtitle}>
                  Encontre e compartilhe caronas com a comunidade acadêmica.
                </Text>
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={onNavigateSearch} 
                style={({ pressed }) => [styles.actionCard, styles.searchCard, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <View style={styles.actionIconLight}>
                  <MapPin size={22} color={colors.white} />
                </View>
                <View>
                  <Text style={styles.actionTitle}>Buscar</Text>
                  <Text style={styles.actionTitle}>carona</Text>
                  <Text style={styles.actionSubtitle}>Encontre uma rota</Text>
                </View>
                <ArrowRight size={17} color={colors.white} style={styles.actionArrow} />
              </Pressable>

              <Pressable
                onPress={() => showComingSoon('Oferecer carona')}
                style={({ pressed }) => [styles.actionCard, styles.offerCard, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <View style={styles.actionIconDark}>
                  <CarFront size={22} color={colors.white} />
                </View>
                <View>
                  <Text style={styles.actionTitle}>Oferecer</Text>
                  <Text style={styles.actionTitle}>carona</Text>
                  <Text style={styles.actionSubtitle}>Compartilhe o trajeto</Text>
                </View>
                <ArrowRight size={17} color={colors.white} style={styles.actionArrow} />
              </Pressable>
            </View>

            <View style={styles.quickSection}>
              <Text style={styles.sectionTitle}>Acesso rápido</Text>
              <View style={styles.quickGrid}>
                <Pressable
                  onPress={() => showComingSoon('Mensagens', 'O chat ainda não está disponível na API V1.')}
                  style={({ pressed }) => [styles.quickItem, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <View style={[styles.quickIcon, styles.messagesIcon]}>
                    <MessageCircle size={19} color="#0EA5E9" />
                  </View>
                  <Text style={styles.quickLabel}>Mensagens</Text>
                </Pressable>
                <Pressable
                  onPress={() => showComingSoon('Histórico', 'A consulta existe na API, mas a tela ainda não foi implementada.')}
                  style={({ pressed }) => [styles.quickItem, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <View style={[styles.quickIcon, styles.historyIcon]}>
                    <CalendarDays size={19} color="#8B5CF6" />
                  </View>
                  <Text style={styles.quickLabel}>Histórico</Text>
                </Pressable>
                <Pressable
                  onPress={() => showComingSoon('Configurações', 'A tela ainda não foi implementada.')}
                  style={({ pressed }) => [styles.quickItem, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <View style={[styles.quickIcon, styles.settingsIcon]}>
                    <Settings size={19} color={colors.muted} />
                  </View>
                  <Text style={styles.quickLabel}>Configurações</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionTitle}>Próximas caronas</Text>
                <Text style={styles.sectionSubtitle}>Suas viagens agendadas</Text>
              </View>
              <View style={styles.sectionIcon}>
                <Clock3 size={18} color={colors.accentDark} />
              </View>
            </View>

            {loading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.emptyText}>Carregando suas caronas...</Text>
              </View>
            ) : ridesError ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{ridesError}</Text>
                <Pressable onPress={() => void loadHome()} accessibilityRole="button">
                  <Text style={styles.retryText}>Atualizar</Text>
                </Pressable>
              </View>
            ) : upcomingRides.length ? (
              <View style={styles.rideList}>
                {upcomingRides.map((ride) => (
                  <View key={ride.id} style={styles.rideCard}>
                    <View style={styles.rideTopRow}>
                      <View style={styles.rideDateBadge}>
                        <Text style={styles.rideDateMonth}>
                          {new Intl.DateTimeFormat('pt-BR', { month: 'short' })
                            .format(new Date(ride.departureAt))
                            .replace('.', '')}
                        </Text>
                        <Text style={styles.rideDateDay}>
                          {new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(new Date(ride.departureAt))}
                        </Text>
                      </View>
                      <View style={styles.rideTimeBlock}>
                        <Text style={styles.rideTime}>
                          {new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
                            .format(new Date(ride.departureAt))}
                        </Text>
                        <Text style={styles.rideStatus}>{statusLabels[ride.status]}</Text>
                      </View>
                      <ChevronRight size={18} color={colors.muted} />
                    </View>

                    <View style={styles.route}>
                      <View style={styles.routeMarker}>
                        <View style={styles.originDot} />
                        <View style={styles.routeLine} />
                        <MapPin size={14} color={colors.accentDark} />
                      </View>
                      <View style={styles.routeNames}>
                        <Text style={styles.routeName} numberOfLines={1}>{ride.originLocation.name}</Text>
                        <Text style={styles.routeNameDestination} numberOfLines={1}>
                          {ride.destinationLocation.name}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.rideFooter}>
                      <Text style={styles.driverName} numberOfLines={1}>{ride.driver.fullName}</Text>
                      <View style={styles.seats}>
                        <Users size={13} color={colors.muted} />
                        <Text style={styles.seatsText}>
                          {ride.driver.id === me?.id
                            ? `${ride.availableSeats} ${ride.availableSeats === 1 ? 'vaga disponível' : 'vagas disponíveis'}`
                            : `${ride.reservations.find((reservation) =>
                              reservation.passengerId === me?.id && reservation.status === 'CONFIRMED',
                            )?.seats ?? 1} vaga reservada`}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <CarFront size={22} color={colors.muted} />
                </View>
                <Text style={styles.emptyTitle}>Nenhuma carona agendada</Text>
                <Text style={styles.emptyText}>
                  Quando você tiver uma viagem, ela aparecerá aqui.
                </Text>
              </View>
            )}

            {me ? (
              <View style={styles.accountInfo}>
                <Text style={styles.accountLabel}>Conta conectada</Text>
                <Text style={styles.accountEmail} numberOfLines={1}>{me.institutionalEmail}</Text>
                {me.roles?.length ? (
                  <Text style={styles.accountRole}>
                    {me.roles.map(({ role }) => role.name === 'DRIVER' ? 'Motorista' :
                      role.name === 'PASSENGER' ? 'Passageiro' : 'Administrador').join(' · ')}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  scrollContent: { flexGrow: 1, backgroundColor: colors.background },
  page: { flexGrow: 1, alignItems: 'center', backgroundColor: colors.background },
  header: { width: '100%', backgroundColor: colors.primary, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 22 },
  headerContent: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { flex: 1, marginRight: 16 },
  greetingLabel: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: '#CBD5E1' },
  greetingName: { fontFamily: fonts.bold, fontSize: 25, lineHeight: 31, color: colors.white },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
  content: { width: '100%', maxWidth: maxContentWidth, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 32 },
  registrationNotice: { marginBottom: 14 },
  errorNotice: { gap: 8, marginBottom: 14 },
  retryText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 20, color: colors.accentDark },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 94, padding: 18, marginBottom: 16, borderRadius: radius, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  introIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.accentBg, alignItems: 'center', justifyContent: 'center' },
  introCopy: { flex: 1, gap: 4 },
  introTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.primary },
  introSubtitle: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.muted },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 27 },
  actionCard: { flex: 1, minHeight: 148, borderRadius: radius, padding: 16, justifyContent: 'space-between', overflow: 'hidden' },
  searchCard: { backgroundColor: colors.accent },
  offerCard: { backgroundColor: colors.primary },
  actionIconLight: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  actionIconDark: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, color: colors.white },
  actionSubtitle: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 15, color: 'rgba(255,255,255,0.78)', marginTop: 5 },
  actionArrow: { position: 'absolute', right: 14, top: 14 },
  pressed: { opacity: 0.86 },
  quickSection: { marginBottom: 25 },
  quickGrid: { flexDirection: 'row', gap: 10, marginTop: 11 },
  quickItem: { flex: 1, minWidth: 0, minHeight: 98, paddingVertical: 12, paddingHorizontal: 5, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: 8 },
  quickIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  messagesIcon: { backgroundColor: '#EFF9FF' },
  historyIcon: { backgroundColor: '#F5F3FF' },
  settingsIcon: { backgroundColor: '#F1F5F9' },
  quickLabel: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 15, color: colors.primary, textAlign: 'center' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.primary },
  sectionSubtitle: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, color: colors.muted, marginTop: 2 },
  sectionIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accentBg, alignItems: 'center', justifyContent: 'center' },
  loadingState: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 10 },
  rideList: { gap: 11 },
  rideCard: { padding: 15, borderRadius: radius, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  rideTopRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 14 },
  rideDateBadge: { width: 44, height: 48, borderRadius: 12, backgroundColor: colors.accentBg, alignItems: 'center', justifyContent: 'center' },
  rideDateMonth: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 14, color: colors.accentDark, textTransform: 'uppercase' },
  rideDateDay: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, color: colors.primary },
  rideTimeBlock: { flex: 1, gap: 3 },
  rideTime: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, color: colors.primary },
  rideStatus: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15, color: colors.muted },
  route: { flexDirection: 'row', gap: 11, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.background },
  routeMarker: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  originDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  routeLine: { width: 1, height: 11, backgroundColor: '#CBD5E1' },
  routeNames: { flex: 1, justifyContent: 'space-between', gap: 8 },
  routeName: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  routeNameDestination: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: colors.primary },
  rideFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 },
  driverName: { flex: 1, fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.foreground },
  seats: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  seatsText: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.muted },
  emptyState: { alignItems: 'center', paddingHorizontal: 22, paddingVertical: 25, borderRadius: radius, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.primary, textAlign: 'center' },
  emptyText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: 'center', marginTop: 5 },
  accountInfo: { marginTop: 22, paddingTop: 15, borderTopWidth: 1, borderTopColor: colors.border },
  accountLabel: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 15, color: colors.muted, textTransform: 'uppercase' },
  accountEmail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.foreground, marginTop: 3 },
  accountRole: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.accentDark, marginTop: 3 },
});
