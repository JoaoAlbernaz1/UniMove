import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Bell,
  CarFront,
  Clock3,
  CreditCard,
  Moon,
  MessageCircle,
  ShieldAlert,
  Sparkles,
} from 'lucide-react-native';
import { colors, fonts, maxContentWidth } from '../theme';
import { useAuth } from '../auth/AuthContext';

type NotificationSettings = {
  enabled: boolean;
  rideRequests: boolean;
  confirmations: boolean;
  reminderMinutes: 0 | 15 | 30 | 60;
  chatMessages: boolean;
  payments: boolean;
  safety: boolean;
  promotions: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
  doNotDisturb: boolean;
  quietStart: string;
  quietEnd: string;
};

const defaults: NotificationSettings = {
  enabled: true,
  rideRequests: true,
  confirmations: true,
  reminderMinutes: 30,
  chatMessages: true,
  payments: true,
  safety: true,
  promotions: false,
  push: true,
  email: true,
  sms: false,
  doNotDisturb: true,
  quietStart: '22:00',
  quietEnd: '07:00',
};

function notificationPayload(settings: NotificationSettings): NotificationSettings {
  return {
    enabled: settings.enabled,
    rideRequests: settings.rideRequests,
    confirmations: settings.confirmations,
    reminderMinutes: settings.reminderMinutes,
    chatMessages: settings.chatMessages,
    payments: settings.payments,
    safety: settings.safety,
    promotions: settings.promotions,
    push: settings.push,
    email: settings.email,
    sms: settings.sms,
    doNotDisturb: settings.doNotDisturb,
    quietStart: settings.quietStart,
    quietEnd: settings.quietEnd,
  };
}

type Props = { onBack: () => void };

const auxiliaryStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  toggleWrap: { alignItems: 'flex-end' },
  preferenceRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  preferenceCopy: { flex: 1, paddingRight: 8 },
  preferenceTitle: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colors.primary },
  preferenceDescription: { marginTop: 3, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  channelChip: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 17,
  },
  channelChipActive: { borderColor: colors.accent, backgroundColor: colors.white },
  channelCheck: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  channelPlaceholder: { width: 12 },
  channelText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  channelTextActive: { color: colors.accentDark },
  phoneInput: {
    height: 42,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: colors.primary,
  },
});

function Toggle({
  value,
  onChange,
  accessibilityLabel,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  accessibilityLabel: string;
}) {
  return (
    <View style={auxiliaryStyles.toggleWrap}>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#D8E0EA', true: colors.accent }}
        thumbColor={colors.white}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

function SectionCard({ children }: { children: ReactNode }) {
  return <View style={auxiliaryStyles.card}>{children}</View>;
}

function PreferenceRow({
  icon,
  iconBackground,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  iconBackground: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <View style={auxiliaryStyles.preferenceRow}>
      <View style={[auxiliaryStyles.iconBox, { backgroundColor: iconBackground }]}>{icon}</View>
      <View style={auxiliaryStyles.preferenceCopy}>
        <Text style={auxiliaryStyles.preferenceTitle}>{title}</Text>
        <Text style={auxiliaryStyles.preferenceDescription}>{description}</Text>
      </View>
      {children}
    </View>
  );
}

function ChannelChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[auxiliaryStyles.channelChip, selected && auxiliaryStyles.channelChipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {selected ? <Text style={auxiliaryStyles.channelCheck}>✓</Text> : <View style={auxiliaryStyles.channelPlaceholder} />}
      <Text style={[auxiliaryStyles.channelText, selected && auxiliaryStyles.channelTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function NotificationSettingsScreen({ onBack }: Props) {
  const { authApi } = useAuth();
  const [settings, setSettings] = useState(defaults);
  const [loaded, setLoaded] = useState(false);
  const [phone, setPhone] = useState('');

  useEffect(() => {
    void authApi<NotificationSettings>('/users/me/notification-preferences').then((value) => {
      setSettings(notificationPayload({ ...defaults, ...value }));
      setLoaded(true);
    }).catch((error: unknown) => {
      Alert.alert('Preferências indisponíveis', error instanceof Error ? error.message : 'Não foi possível carregar suas preferências.');
      setLoaded(true);
    });
    void authApi<{ phone: string | null }>('/users/me/phone')
      .then((value) => setPhone(value.phone ?? ''))
      .catch(() => setPhone(''));
  }, [authApi]);

  useEffect(() => {
    if (!loaded || !settings.push || !Device.isDevice) return;
    void (async () => {
      const existing = await Notifications.getPermissionsAsync();
      const permission = existing.granted
        ? existing
        : await Notifications.requestPermissionsAsync();
      if (!permission.granted) return;
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Notificações',
          importance: 5,
        });
      }
      const token = await Notifications.getExpoPushTokenAsync();
      await authApi('/users/me/push-devices', {
        method: 'POST',
        body: JSON.stringify({ token: token.data, platform: Platform.OS }),
      });
    })().catch((error: unknown) => {
      console.warn('Não foi possível registrar push:', error);
    });
  }, [authApi, loaded, settings.push]);

  useEffect(() => {
    if (!loaded) return;
    void authApi<NotificationSettings>('/users/me/notification-preferences', {
      method: 'PATCH',
      body: JSON.stringify(notificationPayload(settings)),
    }).catch((error: unknown) => {
      Alert.alert('Preferências não salvas', error instanceof Error ? error.message : 'Não foi possível salvar suas preferências.');
    });
  }, [authApi, loaded, settings]);

  function patch(patchValue: Partial<NotificationSettings>) {
    setSettings((current) => ({ ...current, ...patchValue }));
  }

  function editQuietHours() {
    Alert.alert('Horário silencioso', 'Escolha um período:', [
      { text: 'Cancelar', style: 'cancel' },
      { text: '22:00 às 07:00', onPress: () => patch({ quietStart: '22:00', quietEnd: '07:00' }) },
      { text: '23:00 às 08:00', onPress: () => patch({ quietStart: '23:00', quietEnd: '08:00' }) },
    ]);
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
    backButton: { width: 42, height: 48, alignItems: 'flex-start', justifyContent: 'center' },
    headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.white },
    body: { flex: 1 },
    content: {
      width: '100%',
      maxWidth: maxContentWidth,
      alignSelf: 'center',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 28,
    },
    sectionTitle: {
      marginTop: 15,
      marginBottom: 8,
      paddingHorizontal: 6,
      fontFamily: fonts.medium,
      fontSize: 10,
      letterSpacing: 0.3,
      color: colors.muted,
    },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.white,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    preferenceRow: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconBox: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    preferenceCopy: { flex: 1, paddingRight: 8 },
    preferenceTitle: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colors.primary },
    preferenceDescription: { marginTop: 3, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
    toggleWrap: { alignItems: 'flex-end' },
    divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 54 },
    reminderChoices: { flexDirection: 'row', gap: 8, paddingLeft: 54, paddingTop: 2, paddingBottom: 4 },
    choice: { height: 32, minWidth: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#F1F5F9' },
    choiceActive: { backgroundColor: colors.accent },
    choiceText: { fontFamily: fonts.medium, fontSize: 12, color: colors.primary },
    choiceTextActive: { color: colors.white },
    channelLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.primary, marginBottom: 10 },
    channelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    channelChip: {
      height: 34,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 17,
    },
    channelChipActive: { borderColor: colors.accent, backgroundColor: '#FFFFFF' },
    channelCheck: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
    channelPlaceholder: { width: 12 },
    channelText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
    channelTextActive: { color: colors.accentDark },
    editHours: { flexDirection: 'row', paddingLeft: 54, paddingBottom: 4, alignItems: 'center' },
    editHoursText: { fontFamily: fonts.regular, fontSize: 12, color: colors.primary },
    editLink: { marginLeft: 12, fontFamily: fonts.medium, fontSize: 12, color: colors.accentDark },
    pressed: { opacity: 0.82 },
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Pressable onPress={onBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Voltar para Configurações">
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Notificações</Text>
        </View>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.content}>
        <SectionCard>
          <PreferenceRow icon={<Bell size={20} color={colors.accent} />} iconBackground="#DCFCE7" title="Permitir notificações" description="Desative para pausar todos os alertas">
            <Toggle value={settings.enabled} onChange={(value) => patch({ enabled: value })} accessibilityLabel="Permitir notificações" />
          </PreferenceRow>
        </SectionCard>

        <Text style={styles.sectionTitle}>CARONAS</Text>
        <SectionCard>
          <PreferenceRow icon={<CarFront size={20} color={colors.accent} />} iconBackground="#DCFCE7" title="Solicitações de carona" description="Quando alguém pedir uma vaga na sua rota">
            <Toggle value={settings.rideRequests} onChange={(value) => patch({ rideRequests: value })} accessibilityLabel="Solicitações de carona" />
          </PreferenceRow>
          <View style={styles.divider} />
          <PreferenceRow icon={<ShieldAlert size={20} color={colors.primary} />} iconBackground="#EEF2FF" title="Confirmações e cancelamentos" description="Atualizações sobre o status das suas caronas">
            <Toggle value={settings.confirmations} onChange={(value) => patch({ confirmations: value })} accessibilityLabel="Confirmações e cancelamentos" />
          </PreferenceRow>
          <View style={styles.divider} />
          <PreferenceRow icon={<Clock3 size={20} color="#F59E0B" />} iconBackground="#FFF7ED" title="Lembrete antes da partida" description="Aviso antecipado antes da cada carona">
            <Toggle value={settings.reminderMinutes > 0} onChange={(value) => patch({ reminderMinutes: value ? 30 : 0 })} accessibilityLabel="Lembrete antes da partida" />
          </PreferenceRow>
          <View style={styles.reminderChoices}>
            {[15, 30, 60].map((minutes) => (
              <Pressable key={minutes} onPress={() => patch({ reminderMinutes: minutes as 15 | 30 | 60 })} style={[styles.choice, settings.reminderMinutes === minutes && styles.choiceActive]} accessibilityRole="button">
                <Text style={[styles.choiceText, settings.reminderMinutes === minutes && styles.choiceTextActive]}>{minutes === 60 ? '1h' : `${minutes} min`}</Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>

        <Text style={styles.sectionTitle}>MENSAGENS</Text>
        <SectionCard>
          <PreferenceRow icon={<MessageCircle size={20} color={colors.primary} />} iconBackground="#DCFCE7" title="Novas mensagens no chat" description="Quando receber uma mensagem de outro usuário">
            <Toggle value={settings.chatMessages} onChange={(value) => patch({ chatMessages: value })} accessibilityLabel="Novas mensagens no chat" />
          </PreferenceRow>
        </SectionCard>

        <Text style={styles.sectionTitle}>PAGAMENTOS</Text>
        <SectionCard>
          <PreferenceRow icon={<CreditCard size={20} color={colors.primary} />} iconBackground="#EEF2FF" title="Pagamentos realizados e recebidos" description="Confirmações de transações na plataforma">
            <Toggle value={settings.payments} onChange={(value) => patch({ payments: value })} accessibilityLabel="Pagamentos realizados e recebidos" />
          </PreferenceRow>
        </SectionCard>

        <Text style={styles.sectionTitle}>SEGURANÇA</Text>
        <SectionCard>
          <PreferenceRow icon={<ShieldAlert size={20} color="#EF4444" />} iconBackground="#FEE2E2" title="Alertas de segurança e emergência" description="Obrigatório para sua proteção">
            <Toggle value={settings.safety} onChange={(value) => patch({ safety: value })} accessibilityLabel="Alertas de segurança" />
          </PreferenceRow>
        </SectionCard>

        <Text style={styles.sectionTitle}>NOVIDADES</Text>
        <SectionCard>
          <PreferenceRow icon={<Sparkles size={20} color={colors.accent} />} iconBackground="#DCFCE7" title="Promoções e novidades do UniMove" description="Ofertas, atualizações e conteúdo da plataforma">
            <Toggle value={settings.promotions} onChange={(value) => patch({ promotions: value })} accessibilityLabel="Promoções e novidades" />
          </PreferenceRow>
        </SectionCard>

        <Text style={styles.sectionTitle}>CANAIS</Text>
        <SectionCard>
          <Text style={styles.channelLabel}>Receber notificações por:</Text>
          <View style={styles.channelRow}>
            <ChannelChip label="Push" selected={settings.push} onPress={() => patch({ push: !settings.push })} />
            <ChannelChip label="E-mail" selected={settings.email} onPress={() => patch({ email: !settings.email })} />
            <ChannelChip label="SMS" selected={settings.sms} onPress={() => patch({ sms: !settings.sms })} />
          </View>
          {settings.sms ? (
            <TextInput
              value={phone}
              onChangeText={setPhone}
              onBlur={() => {
                void authApi('/users/me/phone', {
                  method: 'PATCH',
                  body: JSON.stringify({ phone }),
                }).catch((error: unknown) => Alert.alert('Telefone não salvo', error instanceof Error ? error.message : 'Não foi possível salvar o telefone.'));
              }}
              placeholder="+55 11 99999-9999"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              style={auxiliaryStyles.phoneInput}
            />
          ) : null}
        </SectionCard>

        <Text style={styles.sectionTitle}>HORÁRIO SILENCIOSO</Text>
        <SectionCard>
          <PreferenceRow icon={<Moon size={20} color={colors.primary} />} iconBackground="#EEF2FF" title="Não perturbe" description={`Das ${settings.quietStart.replace(':', '')} às ${settings.quietEnd.replace(':', '')}`}>
            <Toggle value={settings.doNotDisturb} onChange={(value) => patch({ doNotDisturb: value })} accessibilityLabel="Não perturbe" />
          </PreferenceRow>
          <Pressable onPress={editQuietHours} style={styles.editHours} accessibilityRole="button">
            <Text style={styles.editHoursText}>{`Das ${settings.quietStart} às ${settings.quietEnd}`} </Text>
            <Text style={styles.editLink}>Editar</Text>
          </Pressable>
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}
