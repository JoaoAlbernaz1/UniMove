import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CarFront,
  Check,
  CheckCheck,
  Clock3,
  Flag,
  MapPin,
  MessageCircle,
  MoreVertical,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react-native';
import { useAuth } from '../auth/AuthContext';
import {
  deleteNotification,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications';
import {
  NOTIFICATION_TABS,
  formatRelativeTime,
  groupNotifications,
  groupedCountLabel,
  notificationAppearance,
  notificationTarget,
  rideSummary,
  type AppNotification,
  type NotificationCategory,
  type NotificationIcon,
  type NotificationTarget,
  type NotificationTone,
} from '../notifications';
import { colors, fonts, maxContentWidth, radius } from '../theme';

const icons: Record<NotificationIcon, typeof Bell> = {
  car: CarFront,
  send: Send,
  check: Check,
  x: X,
  clock: Clock3,
  flag: Flag,
  message: MessageCircle,
  shield: ShieldCheck,
  user: UserRound,
  sparkles: Sparkles,
  bell: Bell,
};

// Mesmas combinações de fundo e ícone usadas em Configurações > Notificações.
const tones: Record<NotificationTone, { background: string; color: string }> = {
  success: { background: '#DCFCE7', color: colors.accentDark },
  info: { background: '#EEF2FF', color: colors.primary },
  warning: { background: '#FFF7ED', color: '#F59E0B' },
  danger: { background: '#FEE2E2', color: colors.destructive },
  promo: { background: colors.primary, color: colors.accent },
};

const emptyCopy: Record<NotificationCategory, string> = {
  all: 'Pedidos de carona, confirmações, mensagens e novidades da sua conta aparecem aqui.',
  rides: 'Quando você pedir, oferecer ou concluir uma carona, o andamento aparece aqui.',
  messages: 'Novas mensagens dos seus contatos de carona aparecem aqui.',
  account: 'Atualizações da sua validação, do seu carro e da sua conta aparecem aqui.',
  promotions: 'Promoções e novidades do UniMove aparecem aqui.',
};

type Props = {
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenTarget: (target: Exclude<NotificationTarget, null>) => void;
};

export function NotificationsScreen({ onBack, onOpenSettings, onOpenTarget }: Props) {
  const { authApi } = useAuth();
  const [category, setCategory] = useState<NotificationCategory>('all');
  const [items, setItems] = useState<AppNotification[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Ignora respostas de uma aba anterior que cheguem depois da troca.
  const requestRef = useRef(0);

  const refreshUnread = useCallback(() => {
    getUnreadNotificationCount(authApi).then(setUnread).catch(() => {});
  }, [authApi]);

  const load = useCallback(
    (nextPage: number, mode: 'replace' | 'append') => {
      const request = ++requestRef.current;
      const current = () => request === requestRef.current;
      return listNotifications(authApi, { page: nextPage, category })
        .then((result) => {
          if (!current()) return;
          setItems((previous) => {
            if (mode === 'replace') return result.items;
            const known = new Set(previous.map((item) => item.id));
            return [...previous, ...result.items.filter((item) => !known.has(item.id))];
          });
          setPage(nextPage);
          setTotal(result.total);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!current()) return;
          setError(
            reason instanceof Error ? reason.message : 'Não foi possível carregar as notificações.',
          );
        })
        .finally(() => {
          if (!current()) return;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [authApi, category],
  );

  useEffect(() => {
    void load(1, 'replace');
    refreshUnread();
  }, [load, refreshUnread]);

  function selectCategory(next: NotificationCategory) {
    if (next === category) return;
    setLoading(true);
    setMenuId(null);
    setExpandedId(null);
    setCategory(next);
  }

  // Ao voltar ao app, a lista é atualizada como nos apps de referência.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void load(1, 'replace');
      refreshUnread();
    });
    return () => subscription.remove();
  }, [load, refreshUnread]);

  const sections = useMemo(() => groupNotifications(items), [items]);
  const hasMore = items.length < total;

  function updateLocal(id: string, changes: Partial<AppNotification>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  async function markRead(notification: AppNotification) {
    if (notification.readAt) return;
    updateLocal(notification.id, { readAt: new Date().toISOString() });
    setUnread((count) => Math.max(0, count - 1));
    try {
      await markNotificationRead(authApi, notification.id);
    } catch {
      // Mantém a experiência fluida; a próxima atualização corrige o estado.
      refreshUnread();
    }
  }

  async function open(notification: AppNotification) {
    setMenuId(null);
    setActionError(null);
    void markRead(notification);
    const target = notificationTarget(notification);
    if (target) onOpenTarget(target);
    else setExpandedId((current) => (current === notification.id ? null : notification.id));
  }

  async function markAll() {
    setActionError(null);
    const previous = items;
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt: now })));
    setUnread(0);
    try {
      await markAllNotificationsRead(authApi);
    } catch (reason) {
      setItems(previous);
      refreshUnread();
      setActionError(
        reason instanceof Error ? reason.message : 'Não foi possível marcar como lidas.',
      );
    }
  }

  async function remove(notification: AppNotification) {
    setMenuId(null);
    setActionError(null);
    setItems((current) => current.filter((item) => item.id !== notification.id));
    setTotal((count) => Math.max(0, count - 1));
    if (!notification.readAt) setUnread((count) => Math.max(0, count - 1));
    try {
      await deleteNotification(authApi, notification.id);
    } catch (reason) {
      void load(1, 'replace');
      refreshUnread();
      setActionError(
        reason instanceof Error ? reason.message : 'Não foi possível remover a notificação.',
      );
    }
  }

  function renderItem({ item }: { item: AppNotification }) {
    const appearance = notificationAppearance(item);
    const tone = tones[appearance.tone];
    const Icon = icons[appearance.icon];
    const isUnread = !item.readAt;
    const ride = rideSummary(item.metadata);
    const grouped = groupedCountLabel(item);
    const expanded = expandedId === item.id;
    const menuOpen = menuId === item.id;
    return (
      <View style={[styles.item, isUnread && styles.itemUnread]}>
        <Pressable
          onPress={() => void open(item)}
          accessibilityRole="button"
          accessibilityLabel={`${isUnread ? 'Não lida. ' : ''}${item.title}. ${item.message}`}
          style={({ pressed }) => [styles.itemMain, pressed && styles.pressed]}
        >
          <View style={[styles.itemIcon, { backgroundColor: tone.background }]}>
            <Icon size={20} color={tone.color} />
          </View>
          <View style={styles.itemBody}>
            <View style={styles.itemTitleRow}>
              <Text
                style={[styles.itemTitle, isUnread && styles.itemTitleUnread]}
                numberOfLines={2}
              >
                {item.title}
              </Text>
              <Text style={styles.itemTime}>{formatRelativeTime(item.createdAt)}</Text>
            </View>
            <Text style={styles.itemMessage} numberOfLines={expanded ? undefined : 3}>
              {item.message}
            </Text>
            {grouped ? <Text style={styles.itemGrouped}>{grouped}</Text> : null}
            {ride ? (
              <View style={styles.rideChip}>
                <MapPin size={12} color={colors.muted} />
                <Text style={styles.rideChipText} numberOfLines={1}>
                  {ride.route}
                </Text>
                {ride.when ? <Text style={styles.rideChipWhen}>· {ride.when}</Text> : null}
              </View>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.itemSide}>
          {isUnread ? <View style={styles.unreadDot} accessibilityLabel="Não lida" /> : null}
          <Pressable
            onPress={() => setMenuId(menuOpen ? null : item.id)}
            accessibilityRole="button"
            accessibilityLabel="Mais opções"
            hitSlop={8}
            style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
          >
            <MoreVertical size={18} color={colors.muted} />
          </Pressable>
        </View>
        {menuOpen ? (
          <View style={styles.menu}>
            {isUnread ? (
              <Pressable
                onPress={() => {
                  setMenuId(null);
                  void markRead(item);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.menuAction, pressed && styles.pressed]}
              >
                <Check size={16} color={colors.primary} />
                <Text style={styles.menuText}>Marcar como lida</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void remove(item)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.menuAction, pressed && styles.pressed]}
            >
              <Trash2 size={16} color={colors.destructive} />
              <Text style={[styles.menuText, styles.menuTextDanger]}>Remover notificação</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  const listHeader = actionError ? (
    <View style={styles.actionError}>
      <Text style={styles.actionErrorText}>{actionError}</Text>
    </View>
  ) : undefined;

  let content;
  if (loading) {
    content = (
      <View style={styles.state}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.stateText}>Carregando notificações…</Text>
      </View>
    );
  } else if (error && !items.length) {
    content = (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>Não foi possível carregar</Text>
        <Text style={styles.stateText}>{error}</Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            void load(1, 'replace');
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>Tentar novamente</Text>
        </Pressable>
      </View>
    );
  } else {
    content = (
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        ListHeaderComponent={listHeader}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={[styles.listContent, !items.length && styles.listContentEmpty]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(1, 'replace');
              refreshUnread();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!hasMore || loadingMore || refreshing) return;
          setLoadingMore(true);
          void load(page + 1, 'append');
        }}
        ListEmptyComponent={
          <View style={styles.state}>
            <View style={styles.emptyIcon}>
              <BellOff size={28} color={colors.muted} />
            </View>
            <Text style={styles.stateTitle}>Nada por aqui ainda</Text>
            <Text style={styles.stateText}>{emptyCopy[category]}</Text>
          </View>
        }
        ListFooterComponent={
          items.length ? (
            <View style={styles.footer}>
              {loadingMore ? (
                <ActivityIndicator color={colors.accent} />
              ) : hasMore ? (
                <Pressable
                  onPress={() => {
                    setLoadingMore(true);
                    void load(page + 1, 'append');
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.footerLink}>Carregar mais</Text>
                </Pressable>
              ) : (
                <Text style={styles.footerText}>Você viu todas as notificações.</Text>
              )}
            </View>
          ) : undefined
        }
      />
    );
  }

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
            <View style={styles.appBarCopy}>
              <Text style={styles.appBarTitle}>Notificações</Text>
              <Text style={styles.appBarSubtitle}>
                {unread
                  ? `${unread} ${unread === 1 ? 'não lida' : 'não lidas'}`
                  : 'Você está em dia'}
              </Text>
            </View>
            <Pressable
              onPress={onOpenSettings}
              accessibilityRole="button"
              accessibilityLabel="Configurar notificações"
              style={({ pressed }) => [styles.appBarIcon, pressed && styles.pressed]}
            >
              <Settings size={20} color={colors.white} />
            </Pressable>
          </View>
          {unread ? (
            <Pressable
              onPress={() => void markAll()}
              accessibilityRole="button"
              style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}
            >
              <CheckCheck size={16} color={colors.accent} />
              <Text style={styles.markAllText}>Marcar todas como lidas</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBarInner}
        >
          {NOTIFICATION_TABS.map((tab) => {
            const active = category === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => selectCategory(tab.id)}
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
        </ScrollView>
      </View>

      <View style={styles.body}>{content}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  pressed: { opacity: 0.7 },

  appBar: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  appBarInner: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  appBarRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  appBarCopy: { flex: 1 },
  appBarTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  appBarSubtitle: {
    marginTop: 2,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.60)',
  },
  appBarIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markAll: {
    marginTop: 14,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  markAllText: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent },

  tabBar: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabBarInner: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  tabActive: { backgroundColor: colors.primary },
  tabIdle: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border },
  tabText: { fontFamily: fonts.bold, fontSize: 13, color: colors.primary },
  tabTextActive: { color: colors.white },

  body: { flex: 1 },
  listContent: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 8,
    paddingHorizontal: 4,
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.muted,
  },
  separator: { height: 8 },

  item: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.white,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 6,
  },
  itemUnread: { backgroundColor: colors.accentBg, borderColor: '#BBF7D0' },
  itemMain: { flex: 1, flexDirection: 'row', gap: 12, minWidth: 0 },
  itemIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemTitle: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.primary,
  },
  itemTitleUnread: { fontFamily: fonts.bold },
  itemTime: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, color: colors.muted },
  itemMessage: {
    marginTop: 3,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.foreground,
  },
  itemGrouped: {
    marginTop: 4,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.accentDark,
  },
  rideChip: {
    marginTop: 8,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  rideChipText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  rideChipWhen: { flexShrink: 0, fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  itemSide: { width: 30, alignItems: 'center', gap: 10 },
  unreadDot: {
    marginTop: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  moreButton: { padding: 4, borderRadius: 12 },
  menu: {
    width: '100%',
    marginTop: 12,
    marginRight: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 2,
  },
  menuAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  menuText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary },
  menuTextDanger: { color: colors.destructive },

  actionError: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.destructiveBg,
  },
  actionErrorText: { fontFamily: fonts.medium, fontSize: 13, color: colors.destructive },

  state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 8 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
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

  footer: { alignItems: 'center', paddingVertical: 20 },
  footerLink: { fontFamily: fonts.bold, fontSize: 13, color: colors.accentDark },
  footerText: { fontFamily: fonts.regular, fontSize: 12, color: '#94A3B8' },
});
