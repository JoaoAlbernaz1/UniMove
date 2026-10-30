import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Car, LogOut, Pencil } from 'lucide-react-native';
import { useAuth } from '../auth/AuthContext';
import { getVehicles, type Vehicle } from '../api/vehicles';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Message } from '../components/Message';
import { TagChip } from '../components/TagChip';
import { ProfileDetailsForm } from '../components/ProfileDetailsForm';
import { AchievementCard } from '../components/AchievementCard';
import {
  getMyProfile,
  getProfileAchievements,
  type Profile,
  type ProfileAchievements,
} from '../services/profileService';
import { colors, fonts, maxContentWidth } from '../theme';

export function ProfileScreen({
  userId,
  onBack,
  onRegisterVehicle,
}: {
  userId: string;
  onBack: () => void;
  onRegisterVehicle: () => void;
}) {
  const { authApi, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [achievements, setAchievements] = useState<ProfileAchievements | null>(
    null,
  );
  const [achievementsError, setAchievementsError] = useState<string | null>(
    null,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getMyProfile(authApi),
      getVehicles(authApi),
      getProfileAchievements(authApi),
    ]).then(([profileResult, vehiclesResult, achievementsResult]) => {
      if (!active) return;
      if (
        profileResult.status === 'fulfilled' &&
        profileResult.value.id === userId
      ) {
        setProfile(profileResult.value);
        setError(null);
      } else
        setError(
          profileResult.status === 'rejected' &&
            profileResult.reason instanceof Error
            ? profileResult.reason.message
            : 'Não foi possível carregar este perfil.',
        );
      if (vehiclesResult.status === 'fulfilled') {
        setVehicles(vehiclesResult.value);
        setVehiclesError(null);
      } else
        setVehiclesError(
          'Não foi possível consultar seu carro. Atualize o perfil para tentar novamente.',
        );
      if (achievementsResult.status === 'fulfilled') {
        setAchievements(achievementsResult.value);
        setAchievementsError(null);
      } else setAchievementsError('Não foi possível carregar suas conquistas.');
      setLoading(false);
      setRefreshing(false);
    });
    return () => {
      active = false;
    };
  }, [authApi, userId, attempt]);

  const fullName = profile?.fullName ?? '';
  const earnedAchievements =
    achievements?.items.filter((item) => item.unlocked) ?? [];
  const initials = fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerBar}>
          <Pressable
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Voltar para a tela inicial"
          >
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
        </View>
        <View style={styles.identity}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            {profile && !isEditing ? (
              <Pressable
                style={styles.editBadge}
                onPress={() => setIsEditing(true)}
                accessibilityRole="button"
                accessibilityLabel="Editar perfil"
              >
                <Pencil size={16} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.name}>{fullName}</Text>
          {profile?.course && profile.semester ? (
            <Text style={styles.course}>
              {profile.course} · {profile.semester}º período
            </Text>
          ) : null}
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              setAttempt((value) => value + 1);
            }}
            tintColor={colors.accent}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : error ? (
          <View style={styles.actions}>
            <Message tone="error">{error}</Message>
            <Button
              title="Tentar novamente"
              variant="outline"
              onPress={() => {
                setLoading(true);
                setAttempt((value) => value + 1);
              }}
            />
          </View>
        ) : profile ? (
          <>
            {isEditing ? (
              <ProfileDetailsForm
                initial={profile}
                editing
                onSaved={(updated) => {
                  setProfile(updated);
                  setIsEditing(false);
                }}
                onCancel={() => setIsEditing(false)}
              />
            ) : (
              <>
                {achievementsError || earnedAchievements.length > 0 ? (
                  <View style={styles.achievementSection}>
                    <Text style={styles.sectionTitle}>Conquistas</Text>
                    {achievementsError ? (
                      <View style={styles.actions}>
                        <Message tone="error">{achievementsError}</Message>
                        <Button
                          title="Tentar novamente"
                          variant="outline"
                          onPress={() => setAttempt((value) => value + 1)}
                        />
                      </View>
                    ) : (
                      <View style={styles.achievementList}>
                        {earnedAchievements.map((item) => (
                          <AchievementCard key={item.id} item={item} />
                        ))}
                      </View>
                    )}
                  </View>
                ) : null}
                <Card style={styles.aboutCard}>
                  <Text style={styles.sectionTitle}>Sobre</Text>
                  <Text style={styles.aboutText}>{profile.bio}</Text>
                  <View style={styles.tags}>
                    {profile.tags.map((tag) => (
                      <TagChip key={tag} label={tag} />
                    ))}
                  </View>
                </Card>
                <Button
                  title={
                    vehicles.length ? 'Editar carro' : 'Cadastre seu carro'
                  }
                  onPress={onRegisterVehicle}
                  disabled={!!vehiclesError}
                  variant="outline"
                  icon={Car}
                />
                {vehiclesError ? (
                  <Message tone="error">{vehiclesError}</Message>
                ) : null}
                <View style={styles.reviewsSection}>
                  <Text style={styles.sectionTitle}>Avaliações recebidas</Text>
                  <Card style={styles.reviewsPlaceholder}>
                    <Text style={styles.reviewsHint}>
                      Em breve, suas avaliações recebidas aparecerão aqui.
                    </Text>
                  </Card>
                </View>
              </>
            )}
            <View style={styles.signOut}>
              {confirmingSignOut ? (
                <View style={styles.actions}>
                  <Text style={styles.aboutText}>Deseja sair da conta?</Text>
                  <Button
                    title="Confirmar saída"
                    onPress={() => void signOut()}
                    icon={LogOut}
                  />
                  <Button
                    title="Cancelar"
                    variant="outline"
                    onPress={() => setConfirmingSignOut(false)}
                  />
                </View>
              ) : (
                <Button
                  title="Sair da conta"
                  onPress={() => setConfirmingSignOut(true)}
                  icon={LogOut}
                />
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, width: '100%', paddingBottom: 24 },
  headerBar: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  backButton: { width: 44, height: 44, justifyContent: 'center' },
  identity: { alignItems: 'center', paddingHorizontal: 24 },
  avatarWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.bold, color: colors.white, fontSize: 36 },
  editBadge: {
    position: 'absolute',
    right: 3,
    bottom: 5,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: {
    marginTop: 6,
    fontFamily: fonts.bold,
    fontSize: 25,
    color: colors.white,
  },
  course: {
    marginTop: 6,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.white,
    textAlign: 'center',
    opacity: 0.85,
  },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    padding: 24,
    gap: 20,
  },
  aboutCard: { padding: 18 },
  reviewsSection: { gap: 12 },
  reviewsPlaceholder: { minHeight: 120, padding: 20, justifyContent: 'center' },
  reviewsHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },
  achievementSection: { gap: 12 },
  achievementList: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.primary },
  aboutText: {
    marginTop: 10,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  actions: { gap: 12 },
  signOut: { marginTop: 12 },
});
