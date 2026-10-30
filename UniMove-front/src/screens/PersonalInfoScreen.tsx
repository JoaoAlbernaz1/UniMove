import { useCallback, useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react-native';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import {
  getPersonalInfo,
  getProfilePhoto,
  updatePersonalInfo,
  type PersonalInfo,
} from '../services/personalInfoService';
import { colors, fonts, maxContentWidth } from '../theme';

export function PersonalInfoScreen({ onBack }: { onBack: () => void }) {
  const { authApi, authFetch } = useAuth();
  const [personalInfo, setPersonalInfo] = useState<PersonalInfo | null>(null);
  const [name, setName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [savedPhotoUri, setSavedPhotoUri] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPersonalInfo = useCallback(async () => {
    setError(null);
    try {
      const [info, photo] = await Promise.all([
        getPersonalInfo(authApi),
        getProfilePhoto(authFetch),
      ]);
      setPersonalInfo(info);
      setName(info.fullName);
      setStudentNumber(info.studentNumber ?? '');
      setSavedPhotoUri(photo);
      setSelectedPhoto(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível carregar suas informações pessoais.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authApi, authFetch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadPersonalInfo();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadPersonalInfo]);

  const normalizedStudentNumber = studentNumber.trim().toUpperCase() || null;
  const hasChanges = useMemo(
    () =>
      !!personalInfo &&
      (name.trim() !== personalInfo.fullName ||
        normalizedStudentNumber !== personalInfo.studentNumber ||
        selectedPhoto !== null),
    [name, normalizedStudentNumber, personalInfo, selectedPhoto],
  );

  async function choosePhoto() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 0.9,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (!result.canceled) setSelectedPhoto(result.assets[0]);
    } catch {
      Alert.alert(
        'Não foi possível abrir as fotos',
        'Tente novamente ou escolha outra imagem.',
      );
    }
  }

  async function saveChanges() {
    if (!personalInfo || !hasChanges || saving) return;
    setSaving(true);
    setError(null);
    const changes: { fullName?: string; studentNumber?: string | null } = {};
    if (name.trim() !== personalInfo.fullName) changes.fullName = name.trim();
    if (normalizedStudentNumber !== personalInfo.studentNumber)
      changes.studentNumber = normalizedStudentNumber;
    try {
      const updated = await updatePersonalInfo(
        authApi,
        changes,
        selectedPhoto,
      );
      setPersonalInfo(updated);
      setName(updated.fullName);
      setStudentNumber(updated.studentNumber ?? '');
      if (selectedPhoto) setSavedPhotoUri(selectedPhoto.uri);
      setSelectedPhoto(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível atualizar suas informações.',
      );
    } finally {
      setSaving(false);
    }
  }

  const fullName = name.trim() || 'Usuário';
  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const photoUri = selectedPhoto?.uri ?? savedPhotoUri;

  if (loading && !personalInfo) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <Header onBack={onBack} />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>Carregando informações...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !personalInfo) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <Header onBack={onBack} />
        <View style={styles.errorState}>
          <Message tone="error">{error}</Message>
          <Button
            title="Tentar novamente"
            variant="outline"
            onPress={() => {
              setLoading(true);
              void loadPersonalInfo();
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Header onBack={onBack} />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadPersonalInfo();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {error ? (
          <View style={styles.errorBanner}>
            <Message tone="error">{error}</Message>
          </View>
        ) : null}
        <View style={styles.photoSection}>
          <Pressable
            onPress={() => void choosePhoto()}
            style={styles.photoButton}
            accessibilityRole="button"
            accessibilityLabel="Alterar foto de perfil"
          >
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photo} />
            ) : (
              <Text style={styles.initials}>{initials}</Text>
            )}
            <View style={styles.cameraBadge}>
              <Camera size={16} color={colors.white} />
            </View>
          </Pressable>
          <Pressable
            onPress={() => void choosePhoto()}
            accessibilityRole="button"
          >
            <Text style={styles.changePhoto}>Alterar foto</Text>
          </Pressable>
        </View>

        <View style={styles.fieldsCard}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>NOME COMPLETO</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.editableValue}
              maxLength={100}
              autoCapitalize="words"
              accessibilityLabel="Nome completo"
              editable={!saving}
            />
          </View>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>E-MAIL INSTITUCIONAL</Text>
            <View style={styles.lockedValueRow}>
              <Text style={styles.lockedValue} numberOfLines={1}>
                {personalInfo?.institutionalEmail}
              </Text>
              <LockKeyhole size={15} color="#94A3B8" />
            </View>
          </View>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>NÚMERO DE MATRÍCULA</Text>
            <View style={styles.editableValueRow}>
              <TextInput
                value={studentNumber}
                onChangeText={(value) => setStudentNumber(value.toUpperCase())}
                style={styles.editableInput}
                placeholder="UC00000000"
                placeholderTextColor="#94A3B8"
                maxLength={10}
                autoCapitalize="characters"
                accessibilityLabel="Número de matrícula"
                editable={!saving}
              />
            </View>
          </View>
          <View style={[styles.fieldRow, styles.lastFieldRow]}>
            <Text style={styles.fieldLabel}>CPF</Text>
            <View style={styles.lockedValueRow}>
              <Text style={styles.lockedValue}>{maskCpf(personalInfo?.cpf ?? '')}</Text>
              <LockKeyhole size={15} color="#94A3B8" />
            </View>
          </View>
        </View>

        <View style={styles.actionsCard}>
          <Pressable
            onPress={() => showComingSoon('Validação Cadastral')}
            style={({ pressed }) => [
              styles.actionRow,
              styles.dividedAction,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <View style={styles.actionIcon}>
              <ShieldCheck size={18} color={colors.accentDark} />
            </View>
            <Text style={styles.actionLabel}>Validação Cadastral</Text>
            <ChevronRight size={19} color={colors.muted} />
          </Pressable>
          <Pressable
            onPress={() => showComingSoon('Alterar Senha')}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <View style={styles.actionIcon}>
              <KeyRound size={18} color={colors.primary} />
            </View>
            <Text style={styles.actionLabel}>Alterar Senha</Text>
            <ChevronRight size={19} color={colors.muted} />
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={() => void saveChanges()}
          disabled={!hasChanges || saving}
          style={({ pressed }) => [
            styles.saveButton,
            !hasChanges && styles.saveButtonDisabled,
            pressed && hasChanges && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !hasChanges || saving, busy: saving }}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveLabel}>Salvar alterações</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Voltar para Configurações"
      >
        <ArrowLeft size={22} color={colors.white} />
      </Pressable>
      <Text style={styles.headerTitle}>Informações Pessoais</Text>
    </View>
  );
}

function showComingSoon(moduleName: string) {
  Alert.alert(moduleName, 'Este módulo será desenvolvido em uma próxima etapa.');
}

function maskCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return '***.***.***-**';
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
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
    fontSize: 17,
    color: colors.white,
  },
  body: { flex: 1, backgroundColor: colors.background },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 20,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.muted,
  },
  errorState: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    gap: 14,
  },
  errorBanner: { marginBottom: 14 },
  photoSection: {
    alignItems: 'center',
    marginBottom: 24,
    gap: 8,
  },
  photoButton: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  photo: { width: 82, height: 82, borderRadius: 41 },
  initials: {
    fontFamily: fonts.bold,
    fontSize: 30,
    color: colors.white,
  },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -1,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: colors.primary,
  },
  changePhoto: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.accentDark,
  },
  fieldsCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.white,
    marginBottom: 18,
  },
  fieldRow: {
    minHeight: 72,
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastFieldRow: { borderBottomWidth: 0 },
  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 0.7,
    color: colors.muted,
  },
  editableValue: {
    minHeight: 23,
    padding: 0,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.primary,
  },
  editableValueRow: { flexDirection: 'row', alignItems: 'center' },
  editableInput: {
    flex: 1,
    minHeight: 23,
    padding: 0,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.primary,
  },
  lockedValueRow: {
    minHeight: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  lockedValue: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#7890B3',
  },
  actionsCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  actionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  dividedAction: { borderBottomWidth: 1, borderBottomColor: colors.border },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
  },
  actionLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.primary,
  },
  footer: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  saveButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.accent,
  },
  saveButtonDisabled: { opacity: 0.45 },
  saveLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
  pressed: { opacity: 0.8 },
});
