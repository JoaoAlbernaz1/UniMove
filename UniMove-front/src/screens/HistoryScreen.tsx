import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Calendar,
  Filter,
  MapPin,
  Star,
  Users,
  X,
} from 'lucide-react-native';
import { useAuth } from '../auth/AuthContext';
import {
  fetchHistory,
  fetchHistorySummary,
  formatCurrency,
  formatShortDate,
  formatSigned,
  type HistoryItem,
  type HistorySummary,
} from '../api/history';
import { colors, fonts, maxContentWidth, radius } from '../theme';

// Tons que o protótipo usa só nesta tela e que não estão nos tokens globais.
const starGold = '#F59E0B';
const offeredBadgeBg = '#F0FDF4';
const offeredBadgeText = '#16A34A';
const receivedBadgeBg = '#F1F5F9';
const receivedBadgeText = '#475569';
const footerMuted = '#94A3B8';
const routeDot = '#CBD5E1';
const sheetDivider = '#F1F5F9';

type Tab = 'todas' | 'oferecidas' | 'recebidas';
type Period = '7d' | 'mes' | 'mes-ant' | 'custom';

const TABS: { id: Tab; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'oferecidas', label: 'Oferecidas' },
  { id: 'recebidas', label: 'Recebidas' },
];

const PERIODS: { value: Period; label: string }[] = [
  { value: '7d', label: 'Últimos 7 dias' },
  { value: 'mes', label: 'Este mês' },
  { value: 'mes-ant', label: 'Mês passado' },
  { value: 'custom', label: 'Personalizado' },
];

const STATUSES = [
  { value: 'Concluída', label: 'Concluídas' },
  { value: 'Cancelada', label: 'Canceladas' },
];

const PAGE_SIZE = 50;

// dd/mm/aaaa -> Date local. Retorna null enquanto a digitação não fecha a data.
function parseDate(text: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function periodRange(period: Period, from: string, to: string) {
  const now = new Date();
  if (period === '7d') {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return { start, end: null as Date | null };
  }
  if (period === 'mes') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
  }
  if (period === 'mes-ant') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 1),
    };
  }
  const start = parseDate(from);
  const parsedEnd = parseDate(to);
  // O fim inclui o dia inteiro escolhido.
  const end = parsedEnd ? new Date(parsedEnd.getTime() + 24 * 60 * 60 * 1000) : null;
  return { start, end };
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function RideCard({ item }: { item: HistoryItem }) {
  const isOffered = item.role === 'offered';
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.person}>
          <View style={[styles.avatar, isOffered ? styles.avatarOffered : styles.avatarReceived]}>
            <Text style={styles.avatarText}>{item.initial}</Text>
          </View>
          <View>
            <Text style={styles.personName}>{item.personName}</Text>
            {item.rating === null ? (
              <Text style={styles.noRating}>Sem avaliação</Text>
            ) : (
              <View style={styles.ratingRow}>
                <Star size={12} color={starGold} fill={starGold} />
                <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={[styles.badge, isOffered ? styles.badgeOffered : styles.badgeReceived]}>
          <Text
            style={[
              styles.badgeText,
              isOffered ? styles.badgeTextOffered : styles.badgeTextReceived,
            ]}
          >
            {isOffered ? 'Oferecida' : 'Recebida'}
          </Text>
        </View>
      </View>

      <View style={styles.route}>
        <View style={styles.routeSide}>
          <View style={styles.originDot} />
          <Text style={styles.routeText} numberOfLines={1}>
            {item.from}
          </Text>
        </View>
        <View style={styles.routeDots}>
          <View style={styles.routeDotSmall} />
          <View style={styles.routeDotSmall} />
          <View style={styles.routeDotSmall} />
        </View>
        <View style={[styles.routeSide, styles.routeSideEnd]}>
          <MapPin size={13} color={colors.primary} />
          <Text style={styles.routeText} numberOfLines={1}>
            {item.to}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.footerMeta}>
          <Calendar size={12} color={footerMuted} />
          <Text style={styles.footerText}>{formatShortDate(item.departureAt)}</Text>
          {isOffered && item.passengers > 0 ? (
            <>
              <Text style={styles.footerText}>·</Text>
              <Users size={12} color={footerMuted} />
              <Text style={styles.footerText}>
                {item.passengers} {item.passengers === 1 ? 'passageiro' : 'passageiros'}
              </Text>
            </>
          ) : null}
          <Text style={styles.footerText}>·</Text>
          <Text style={styles.footerText}>{item.status}</Text>
        </View>
        <Text style={[styles.amount, isOffered ? styles.amountIn : styles.amountOut]}>
          {formatSigned(item.amountCents)}
        </Text>
      </View>
    </View>
  );
}

export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const { authApi } = useAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>('todas');
  const [filterOpen, setFilterOpen] = useState(false);
  const [period, setPeriod] = useState<Period>('mes');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [activeStatuses, setActiveStatuses] = useState<string[]>(['Concluída']);

  // A primeira carga já nasce com loading ligado; só a recarga manual o reativa,
  // o que mantém o efeito livre de setState síncrono.
  const load = useCallback(async (refreshing = false) => {
    if (refreshing) {
      setLoading(true);
      setError(null);
    }
    try {
      const [list, totals] = await Promise.all([
        fetchHistory(authApi, 1, PAGE_SIZE),
        fetchHistorySummary(authApi),
      ]);
      setItems(list);
      setSummary(totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar o histórico.');
    } finally {
      setLoading(false);
    }
  }, [authApi]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const { start, end } = periodRange(period, customFrom, customTo);
    return items.filter((item) => {
      if (activeTab === 'oferecidas' && item.role !== 'offered') return false;
      if (activeTab === 'recebidas' && item.role !== 'received') return false;
      if (activeStatuses.length && !activeStatuses.includes(item.status)) return false;
      const date = new Date(item.departureAt);
      if (start && date < start) return false;
      if (end && date >= end) return false;
      return true;
    });
  }, [items, activeTab, activeStatuses, period, customFrom, customTo]);

  const toggleStatus = (value: string) =>
    setActiveStatuses((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );

  const clearFilters = () => {
    setPeriod('mes');
    setCustomFrom('');
    setCustomTo('');
    setActiveStatuses(['Concluída']);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.appBar}>
        <View style={styles.appBarInner}>
          <View style={styles.appBarRow}>
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Voltar"
              hitSlop={8}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <ArrowLeft size={24} color={colors.white} />
            </Pressable>
            <Text style={styles.appBarTitle}>Histórico</Text>
          </View>

          <View style={styles.statsRow}>
            <StatCard label="Total" value={summary ? String(summary.totalRides) : '—'} />
            <StatCard
              label="Ganhos"
              value={summary ? formatCurrency(summary.earningsCents) : '—'}
            />
            <StatCard
              label="Gastos"
              value={summary ? formatCurrency(summary.spendingCents) : '—'}
            />
          </View>
        </View>
      </View>

      <View style={styles.tabBar}>
        <View style={styles.tabBarInner}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.tab,
                  active ? styles.tabActive : styles.tabIdle,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setFilterOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Filtrar histórico"
            style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
          >
            <Filter size={20} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View style={styles.list}>
          {loading ? (
            <View style={styles.state}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.stateText}>Carregando seu histórico…</Text>
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Text style={styles.stateTitle}>Não foi possível carregar</Text>
              <Text style={styles.stateText}>{error}</Text>
              <Pressable
                onPress={() => void load(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              >
                <Text style={styles.retryText}>Tentar de novo</Text>
              </Pressable>
            </View>
          ) : visible.length === 0 ? (
            <View style={styles.state}>
              <Text style={styles.stateTitle}>Nada por aqui</Text>
              <Text style={styles.stateText}>
                {items.length === 0
                  ? 'Quando você oferecer ou pegar uma carona, ela aparece aqui.'
                  : 'Nenhuma carona corresponde aos filtros escolhidos.'}
              </Text>
            </View>
          ) : (
            visible.map((item) => <RideCard key={item.id} item={item} />)
          )}
        </View>
      </ScrollView>

      <Modal
        visible={filterOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterOpen(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setFilterOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Fechar filtros"
        />
        <View style={styles.sheet}>
          <View style={styles.sheetInner}>
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Filtrar Histórico</Text>
              <Pressable
                onPress={() => setFilterOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Fechar"
                style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}
              >
                <X size={16} color={colors.muted} />
              </Pressable>
            </View>

            <Text style={styles.sheetLabel}>PERÍODO</Text>
            <View style={styles.chipWrap}>
              {PERIODS.map(({ value, label }) => {
                const active = period === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setPeriod(value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {period === 'custom' ? (
              <View style={styles.customRow}>
                <TextInput
                  style={styles.dateInput}
                  value={customFrom}
                  onChangeText={setCustomFrom}
                  placeholder="dd/mm/aaaa"
                  placeholderTextColor={footerMuted}
                  keyboardType="numeric"
                  accessibilityLabel="Data inicial, no formato dd/mm/aaaa"
                />
                <Text style={styles.customSeparator}>até</Text>
                <TextInput
                  style={styles.dateInput}
                  value={customTo}
                  onChangeText={setCustomTo}
                  placeholder="dd/mm/aaaa"
                  placeholderTextColor={footerMuted}
                  keyboardType="numeric"
                  accessibilityLabel="Data final, no formato dd/mm/aaaa"
                />
              </View>
            ) : null}

            <Text style={styles.sheetLabel}>STATUS DA CARONA</Text>
            <View style={styles.chipWrap}>
              {STATUSES.map(({ value, label }) => {
                const active = activeStatuses.includes(value);
                return (
                  <Pressable
                    key={value}
                    onPress={() => toggleStatus(value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.sheetActions}>
              <Pressable
                onPress={clearFilters}
                accessibilityRole="button"
                style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
              >
                <Text style={styles.clearText}>Limpar</Text>
              </Pressable>
              <Pressable
                onPress={() => setFilterOpen(false)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.applyButton, pressed && styles.pressed]}
              >
                <Text style={styles.applyText}>Aplicar Filtros</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  pressed: { opacity: 0.7 },

  appBar: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 8,
  },
  appBarInner: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  appBarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 },
  appBarTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.60)',
    marginBottom: 4,
  },
  statValue: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },

  tabBar: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tabBarInner: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  tabActive: { backgroundColor: colors.primary },
  tabIdle: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border },
  tabText: { fontFamily: fonts.bold, fontSize: 13, color: colors.primary },
  tabTextActive: { color: colors.white },
  filterButton: { marginLeft: 'auto', padding: 8, borderRadius: 12 },

  listContent: { paddingHorizontal: 16, paddingVertical: 16 },
  list: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', gap: 12 },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarOffered: { backgroundColor: colors.accent },
  avatarReceived: { backgroundColor: colors.primary },
  avatarText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  personName: { fontFamily: fonts.bold, fontSize: 14, color: colors.primary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ratingText: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  noRating: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },

  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeOffered: { backgroundColor: offeredBadgeBg },
  badgeReceived: { backgroundColor: receivedBadgeBg },
  badgeText: { fontFamily: fonts.bold, fontSize: 11 },
  badgeTextOffered: { color: offeredBadgeText },
  badgeTextReceived: { color: receivedBadgeText },

  route: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  routeSide: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  routeSideEnd: { justifyContent: 'flex-end' },
  originDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  routeText: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, flexShrink: 1 },
  routeDots: { flexDirection: 'row', gap: 2 },
  routeDotSmall: { width: 4, height: 4, borderRadius: 2, backgroundColor: routeDot },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: sheetDivider,
    gap: 8,
  },
  footerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  footerText: { fontFamily: fonts.regular, fontSize: 12, color: footerMuted },
  amount: { fontFamily: fonts.bold, fontSize: 14 },
  amountIn: { color: offeredBadgeText },
  amountOut: { color: colors.destructive },

  state: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  stateTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.primary },
  stateText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  retryText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.40)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  sheetInner: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  handleWrap: { alignItems: 'center', marginBottom: 16 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.primary },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: sheetDivider,
  },
  sheetLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.muted,
    marginBottom: 10,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: receivedBadgeText },
  chipTextActive: { color: colors.white },

  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.foreground,
    backgroundColor: colors.inputBg,
  },
  customSeparator: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },

  sheetActions: { flexDirection: 'row', gap: 12 },
  clearButton: { flex: 1, paddingVertical: 14, borderRadius: radius, alignItems: 'center' },
  clearText: { fontFamily: fonts.bold, fontSize: 14, color: colors.muted },
  applyButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: radius,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  applyText: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
});
