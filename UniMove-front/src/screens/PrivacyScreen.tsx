import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  GraduationCap,
  MapPin,
  MonitorSmartphone,
  Navigation,
  Shield,
  Smartphone,
  UserRoundCheck,
  UserX,
} from 'lucide-react-native';
import { registrationPolicy, type RegistrationPolicy } from '../api/auth';
import { LegalModal } from '../components/LegalModal';
import { colors, fonts, maxContentWidth } from '../theme';
import { useAuth } from '../auth/AuthContext';

type PrivacySettings = {
  profileVisibility: 'UNIVERSITY' | 'CONFIRMED';
  courseSemester: boolean;
  ratings: boolean;
  phoneSharing: boolean;
  realTimeLocation: boolean;
  frequentLocations: boolean;
};

const defaults: PrivacySettings = {
  profileVisibility: 'UNIVERSITY',
  courseSemester: true,
  ratings: true,
  phoneSharing: false,
  realTimeLocation: true,
  frequentLocations: true,
};

function privacyPayload(settings: PrivacySettings): PrivacySettings {
  return {
    profileVisibility: settings.profileVisibility,
    courseSemester: settings.courseSemester,
    ratings: settings.ratings,
    phoneSharing: settings.phoneSharing,
    realTimeLocation: settings.realTimeLocation,
    frequentLocations: settings.frequentLocations,
  };
}

const privacyAuxiliaryStyles = StyleSheet.create({
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowCopy: { flex: 1, paddingRight: 8 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colors.primary },
  rowDescription: { marginTop: 3, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  actionRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center' },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionCopy: { flex: 1, paddingRight: 8 },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    backgroundColor: colors.destructive,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 11, color: colors.white },
  twoFactorSetup: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  qrCode: { width: 180, height: 180, marginBottom: 10 },
  twoFactorSecret: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginBottom: 8 },
  twoFactorInput: {
    width: 180,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    textAlign: 'center',
    color: colors.primary,
    marginBottom: 10,
  },
});

function PrivacyToggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: '#D8E0EA', true: colors.accent }}
      thumbColor={colors.white}
      accessibilityLabel={label}
    />
  );
}

function PrivacyPreviewRow({
  icon,
  iconBackground,
  title,
  description,
  value,
  onChange,
}: {
  icon: ReactNode;
  iconBackground: string;
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={privacyAuxiliaryStyles.row}>
      <View style={[privacyAuxiliaryStyles.iconBox, { backgroundColor: iconBackground }]}>{icon}</View>
      <View style={privacyAuxiliaryStyles.rowCopy}>
        <Text style={privacyAuxiliaryStyles.rowTitle}>{title}</Text>
        <Text style={privacyAuxiliaryStyles.rowDescription}>{description}</Text>
      </View>
      <PrivacyToggle value={value} onChange={onChange} label={title} />
    </View>
  );
}

function PrivacyActionRow({
  icon,
  iconBackground,
  title,
  detail,
  badge,
  onPress,
}: {
  icon: ReactNode;
  iconBackground: string;
  title: string;
  detail: string;
  badge?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={privacyAuxiliaryStyles.actionRow} accessibilityRole="button">
      <View style={[privacyAuxiliaryStyles.actionIcon, { backgroundColor: iconBackground }]}>{icon}</View>
      <View style={privacyAuxiliaryStyles.actionCopy}>
        <Text style={privacyAuxiliaryStyles.rowTitle}>{title}</Text>
        <Text style={privacyAuxiliaryStyles.rowDescription}>{detail}</Text>
      </View>
      {badge ? <View style={privacyAuxiliaryStyles.badge}><Text style={privacyAuxiliaryStyles.badgeText}>{badge}</Text></View> : null}
      <ChevronRight size={18} color={colors.muted} />
    </Pressable>
  );
}

export function PrivacyScreen({ onBack }: { onBack: () => void }) {
  const { authApi } = useAuth();
  const [settings, setSettings] = useState(defaults);
  const [loaded, setLoaded] = useState(false);
  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null);
  const [document, setDocument] = useState<RegistrationPolicy['privacyPolicy'] | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; qrCode: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [blockedCount, setBlockedCount] = useState(0);

  useEffect(() => {
    void authApi<PrivacySettings>('/users/me/privacy-preferences').then((value) => {
      setSettings(privacyPayload({ ...defaults, ...value }));
      setLoaded(true);
    }).catch((error: unknown) => {
      Alert.alert('Preferências indisponíveis', error instanceof Error ? error.message : 'Não foi possível carregar suas preferências.');
      setLoaded(true);
    });
    void registrationPolicy().then(setPolicy).catch(() => setPolicy(null));
    void authApi<{ enabled: boolean }>('/users/me/two-factor')
      .then((status) => setTwoFactorEnabled(status.enabled))
      .catch(() => setTwoFactorEnabled(false));
    void authApi<{ blockedId: string }[]>('/users/me/blocked-users')
      .then((items) => setBlockedCount(items.length))
      .catch(() => setBlockedCount(0));
  }, [authApi]);

  useEffect(() => {
    if (!loaded) return;
    void authApi<PrivacySettings>('/users/me/privacy-preferences', {
      method: 'PATCH',
      body: JSON.stringify(privacyPayload(settings)),
    }).catch((error: unknown) => {
      Alert.alert('Preferências não salvas', error instanceof Error ? error.message : 'Não foi possível salvar suas preferências.');
    });
  }, [authApi, loaded, settings]);

  function patch(patchValue: Partial<PrivacySettings>) {
    setSettings((current) => ({ ...current, ...patchValue }));
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
      paddingVertical: 6,
    },
    visibilityLabel: {
      paddingTop: 6,
      paddingBottom: 8,
      fontFamily: fonts.regular,
      fontSize: 12,
      color: colors.primary,
    },
    visibilityChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
    visibilityChoice: {
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: 17,
      backgroundColor: '#F1F5F9',
    },
    visibilityChoiceActive: { backgroundColor: colors.accent },
    visibilityChoiceText: { fontFamily: fonts.medium, fontSize: 12, color: colors.primary },
    visibilityChoiceTextActive: { color: colors.white },
    row: { minHeight: 66, flexDirection: 'row', alignItems: 'center' },
    iconBox: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    rowCopy: { flex: 1, paddingRight: 8 },
    rowTitle: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colors.primary },
    rowDescription: { marginTop: 3, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
    divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 54 },
    actionRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center' },
    actionIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    actionCopy: { flex: 1, paddingRight: 8 },
    badge: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 6,
      backgroundColor: colors.destructive,
    },
    badgeText: { fontFamily: fonts.bold, fontSize: 11, color: colors.white },
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Pressable onPress={onBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Voltar para Configurações">
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Privacidade</Text>
        </View>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>VISIBILIDADE DO PERFIL</Text>
        <View style={styles.card}>
          <Text style={styles.visibilityLabel}>Quem pode ver meu perfil completo</Text>
          <View style={styles.visibilityChoices}>
            {[
              ['UNIVERSITY', 'Toda a universidade'],
              ['CONFIRMED', 'Só caronas confirmadas'],
            ].map(([value, label]) => (
              <Pressable key={value} onPress={() => patch({ profileVisibility: value as PrivacySettings['profileVisibility'] })} style={[styles.visibilityChoice, settings.profileVisibility === value && styles.visibilityChoiceActive]} accessibilityRole="button">
                <Text style={[styles.visibilityChoiceText, settings.profileVisibility === value && styles.visibilityChoiceTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <PrivacyPreviewRow icon={<GraduationCap size={20} color={colors.primary} />} iconBackground="#EEF2FF" title="Mostrar curso e semestre" description="Exibir informações acadêmicas no seu perfil" value={settings.courseSemester} onChange={(value) => patch({ courseSemester: value })} />
          <View style={styles.divider} />
          <PrivacyPreviewRow icon={<Shield size={20} color={colors.accent} />} iconBackground="#DCFCE7" title="Mostrar avaliações no perfil" description="Sua nota média fica visível para outros usuários" value={settings.ratings} onChange={(value) => patch({ ratings: value })} />
          <View style={styles.divider} />
          <PrivacyPreviewRow icon={<Smartphone size={20} color={colors.primary} />} iconBackground="#F1F5F9" title="Compartilhar telefone com caronas confirmadas" description="Somente após confirmação da carona" value={settings.phoneSharing} onChange={(value) => patch({ phoneSharing: value })} />
        </View>

        <Text style={styles.sectionTitle}>LOCALIZAÇÃO</Text>
        <View style={styles.card}>
          <PrivacyPreviewRow icon={<MapPin size={20} color={colors.accent} />} iconBackground="#DCFCE7" title="Localização em tempo real durante a carona" description="Necessária para o sistema de emergência" value={settings.realTimeLocation} onChange={(value) => patch({ realTimeLocation: value })} />
          <View style={styles.divider} />
          <PrivacyPreviewRow icon={<Navigation size={20} color="#F59E0B" />} iconBackground="#FFF7ED" title="Salvar locais frequentes" description="Sugere destinos com base no seu histórico" value={settings.frequentLocations} onChange={(value) => patch({ frequentLocations: value })} />
        </View>

        <Text style={styles.sectionTitle}>SEGURANÇA DA CONTA</Text>
        <View style={styles.card}>
          <PrivacyPreviewRow
            icon={<Shield size={20} color="#F97316" />}
            iconBackground="#FFF7ED"
            title="Verificação em duas etapas"
            description="Proteção extra com segundo fator de autenticação"
            value={twoFactorEnabled}
            onChange={(value) => {
              if (!value) {
                Alert.alert('Desativar verificação', 'Digite sua senha pela tela de segurança da conta para confirmar a desativação.');
                return;
              }
              void authApi<{ secret: string; qrCode: string }>('/users/me/two-factor/setup', { method: 'POST' })
                .then((setup) => {
                  setTwoFactorSetup(setup);
                  setTwoFactorCode('');
                })
                .catch((error: unknown) => Alert.alert('2FA não configurado', error instanceof Error ? error.message : 'Não foi possível iniciar a configuração.'));
            }}
          />
          {twoFactorSetup ? (
            <View style={privacyAuxiliaryStyles.twoFactorSetup}>
              <Image source={{ uri: twoFactorSetup.qrCode }} style={privacyAuxiliaryStyles.qrCode} />
              <Text style={privacyAuxiliaryStyles.twoFactorSecret}>Código manual: {twoFactorSetup.secret}</Text>
              <TextInput
                value={twoFactorCode}
                onChangeText={(value) => setTwoFactorCode(value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                style={privacyAuxiliaryStyles.twoFactorInput}
              />
              <Pressable
                onPress={() => {
                  void authApi<{ enabled: boolean }>('/users/me/two-factor/enable', {
                    method: 'POST',
                    body: JSON.stringify({ code: twoFactorCode }),
                  }).then((status) => {
                    setTwoFactorEnabled(status.enabled);
                    setTwoFactorSetup(null);
                    setTwoFactorCode('');
                    Alert.alert('Verificação ativada', 'Sua conta agora exige o código de autenticação no login.');
                  }).catch((error: unknown) => Alert.alert('Código inválido', error instanceof Error ? error.message : 'Não foi possível ativar.'));
                }}
                style={[styles.visibilityChoice, styles.visibilityChoiceActive]}
                accessibilityRole="button"
              >
                <Text style={[styles.visibilityChoiceText, styles.visibilityChoiceTextActive]}>Ativar verificação</Text>
              </Pressable>
            </View>
          ) : null}
          {twoFactorEnabled && !twoFactorSetup ? (
            <View style={privacyAuxiliaryStyles.twoFactorSetup}>
              <TextInput
                value={disablePassword}
                onChangeText={setDisablePassword}
                placeholder="Senha atual"
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={privacyAuxiliaryStyles.twoFactorInput}
              />
              <Pressable
                onPress={() => {
                  void authApi<{ enabled: boolean }>('/users/me/two-factor/disable', {
                    method: 'POST',
                    body: JSON.stringify({ password: disablePassword }),
                  }).then((status) => {
                    setTwoFactorEnabled(status.enabled);
                    setDisablePassword('');
                    Alert.alert('Verificação desativada', 'Sua conta voltou a usar apenas senha e e-mail.');
                  }).catch((error: unknown) => Alert.alert('Não foi possível desativar', error instanceof Error ? error.message : 'Senha inválida.'));
                }}
                style={[styles.visibilityChoice, styles.visibilityChoiceActive]}
                accessibilityRole="button"
              >
                <Text style={[styles.visibilityChoiceText, styles.visibilityChoiceTextActive]}>Desativar verificação</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.divider} />
          <PrivacyActionRow
            icon={<MonitorSmartphone size={20} color={colors.primary} />}
            iconBackground="#EEF2FF"
            title="Dispositivos conectados"
            detail="Gerencie as sessões de login"
            onPress={() => {
              void authApi<{ id: string; userAgent: string | null; createdAt: string }[]>('/users/me/security-sessions')
                .then((sessions) => Alert.alert(
                  'Sessões de login',
                  sessions.length
                    ? sessions.map((session, index) => `${index + 1}. ${session.userAgent || 'Dispositivo desconhecido'}`).join('\n\n')
                    : 'Nenhuma sessão ativa encontrada.',
                ))
                .catch((error: unknown) => Alert.alert('Sessões indisponíveis', error instanceof Error ? error.message : 'Não foi possível carregar as sessões.'));
            }}
          />
          <View style={styles.divider} />
          <PrivacyActionRow
            icon={<UserX size={20} color="#EF4444" />}
            iconBackground="#FEE2E2"
            title="Usuários bloqueados"
            detail="Gerenciar lista de bloqueados"
            badge={blockedCount ? String(blockedCount) : undefined}
            onPress={() => {
              void authApi<{ blockedId: string; blocked: { fullName: string } }[]>('/users/me/blocked-users')
                .then((items) => Alert.alert(
                  'Usuários bloqueados',
                  items.length ? items.map((item) => item.blocked.fullName).join('\n') : 'Nenhum usuário bloqueado.',
                ))
                .catch((error: unknown) => Alert.alert('Lista indisponível', error instanceof Error ? error.message : 'Não foi possível carregar os bloqueios.'));
            }}
          />
        </View>

        <Text style={styles.sectionTitle}>SEUS DADOS (LGPD)</Text>
        <View style={styles.card}>
          <PrivacyActionRow
            icon={<Download size={20} color={colors.primary} />}
            iconBackground="#EEF2FF"
            title="Baixar meus dados"
            detail="Solicite uma cópia dos seus dados"
            onPress={() => {
              void authApi<{ id: string }>('/users/me/data-export', { method: 'POST' })
                .then((request) => Alert.alert(
                  'Exportação criada',
                  `Sua cópia está pronta para consulta pelo aplicativo e pela API. Solicitação: ${request.id}`,
                ))
                .catch((error: unknown) => Alert.alert('Exportação indisponível', error instanceof Error ? error.message : 'Não foi possível criar a solicitação.'));
            }}
          />
          <View style={styles.divider} />
          <PrivacyActionRow icon={<UserRoundCheck size={20} color="#8B5CF6" />} iconBackground="#F3E8FF" title="Gerenciar consentimentos" detail="Revise e ajuste suas permissões de dados" onPress={() => Alert.alert('Consentimentos', 'As preferências desta tela controlam suas permissões atuais.')} />
          <View style={styles.divider} />
          <PrivacyActionRow icon={<FileText size={20} color={colors.accent} />} iconBackground="#DCFCE7" title="Política de Privacidade" detail="Como o UniMove trata seus dados" onPress={() => setDocument(policy?.privacyPolicy ?? { title: 'Política de Privacidade', sections: [{ heading: 'Dados que tratamos', body: 'Carregando a política atual do servidor...' }] })} />
          <View style={styles.divider} />
          <PrivacyActionRow icon={<FileText size={20} color="#F97316" />} iconBackground="#FFF7ED" title="Termos de Uso" detail="Regras de uso da plataforma" onPress={() => setDocument(policy?.termsOfUse ?? { title: 'Termos de Uso', sections: [{ heading: 'Termos atuais', body: 'Carregando os termos do servidor...' }] })} />
        </View>
      </ScrollView>
      <LegalModal document={document} onClose={() => setDocument(null)} />
    </SafeAreaView>
  );
}
