import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, LogOut, Pencil, Star } from 'lucide-react-native';
import { useAuth } from '../auth/AuthContext';
import { AchievementCard } from '../components/AchievementCard';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Message } from '../components/Message';
import { ReviewItem } from '../components/ReviewItem';
import { StatCard } from '../components/StatCard';
import { TagChip } from '../components/TagChip';
import {
  getProfile,
  getProfileAchievements,
  getProfileReviews,
  getProfileStats,
  updateProfile,
  type Achievement,
  type Profile,
  type ProfileReview,
  type ProfileStats,
} from '../services/profileService';
import { colors, fonts, maxContentWidth } from '../theme';

export function ProfileScreen({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { authApi, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<ProfileStats[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [reviews, setReviews] = useState<ProfileReview[]>([]);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [fullNameDraft, setFullNameDraft] = useState('');
  const [bioDraft, setBioDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    setError(null);
    try {
      const [profileResult, statsResult, achievementsResult, reviewsResult] = await Promise.allSettled([
        getProfile(authApi, userId),
        getProfileStats(),
        getProfileAchievements(),
        getProfileReviews(),
      ]);
      if (profileResult.status === 'rejected') throw profileResult.reason;
      const loadedProfile = profileResult.value;
      setProfile(loadedProfile);
      setFullNameDraft(loadedProfile.fullName);
      setBioDraft(loadedProfile.bio);
      setTagsDraft([...loadedProfile.tags]);
      if (statsResult.status === 'fulfilled') setStats(statsResult.value); else setStats([]);
      if (achievementsResult.status === 'fulfilled') setAchievements(achievementsResult.value); else setAchievements([]);
      if (reviewsResult.status === 'fulfilled') setReviews(reviewsResult.value); else setReviews([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o perfil.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authApi, userId]);

  useEffect(() => {
    const timer = setTimeout(() => { void loadProfile(); }, 0);
    return () => clearTimeout(timer);
  }, [loadProfile]);

  function startEditing() {
    if (!profile?.isOwner) return;
    setFullNameDraft(profile.fullName);
    setBioDraft(profile.bio);
    setTagsDraft([...profile.tags]);
    setIsEditing(true);
  }

  function cancelEditing() {
    if (!profile) return;
    setFullNameDraft(profile.fullName);
    setBioDraft(profile.bio);
    setTagsDraft([...profile.tags]);
    setNewTag('');
    setIsEditing(false);
  }

  async function saveProfile() {
    if (!profile || !fullNameDraft.trim()) return;
    setSaving(true);
    try {
      const updated = await updateProfile(authApi, {
        fullName: fullNameDraft.trim(),
        bio: bioDraft,
        tags: tagsDraft,
      });
      setProfile(updated);
      setFullNameDraft(updated.fullName);
      setBioDraft(updated.bio);
      setTagsDraft([...updated.tags]);
      setNewTag('');
      setIsEditing(false);
    } catch (reason) {
      Alert.alert('Erro', reason instanceof Error ? reason.message : 'Não foi possível salvar o perfil.');
    } finally {
      setSaving(false);
    }
  }

  function confirmSignOut() {
    Alert.alert('Sair da conta', 'Deseja realmente encerrar sua sessão?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  function addTag() {
    const tag = newTag.trim();
    if (!tag || tagsDraft.includes(tag)) return;
    setTagsDraft((current) => [...current, tag]);
    setNewTag('');
  }

  const fullName = profile?.fullName?.trim() || 'Usuário';
  const initials = fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const visibleReviews = showAllReviews ? reviews : reviews.slice(0, 2);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerBar}>
          <Pressable onPress={onBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Voltar para a tela inicial">
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
        </View>
        <View style={styles.profileIdentity}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>{loading ? null : <Text style={styles.avatarText}>{initials}</Text>}</View>
            {!loading && profile?.isOwner && !isEditing ? (
              <Pressable style={styles.editBadge} onPress={startEditing} accessibilityRole="button" accessibilityLabel="Editar perfil">
                <Pencil size={16} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.name}>{fullName}</Text>
          <Text style={styles.course}>{profile?.course ?? 'Engenharia'} · {profile?.semester ?? '3º ano'}</Text>
          <View style={styles.ratingLine}><Star size={16} color="#2563EB" fill="#2563EB" /><Text style={styles.rating}>4.9</Text><Text style={styles.reviewCount}>(42 avaliações)</Text></View>
        </View>
      </View>

      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadProfile(); }} tintColor={colors.accent} />}
      >
        {loading && !profile ? (
          <View style={styles.loader}><ActivityIndicator color={colors.accent} /></View>
        ) : error ? (
          <View style={styles.errorState}><Message tone="error">{error}</Message><Button title="Tentar novamente" onPress={() => { setLoading(true); void loadProfile(); }} variant="outline" /></View>
        ) : profile ? (
          <>
            <View style={styles.statsRow}>{stats.length ? stats.map((item) => <StatCard key={item.id} item={item} />) : <Text style={styles.emptyText}>Nenhuma estatística disponível.</Text>}</View>

            {isEditing ? (
              <Card style={styles.aboutCard}>
                <Text style={styles.aboutTitle}>Editar perfil</Text>
                <Text style={styles.inputLabel}>Nome completo</Text>
                <TextInput value={fullNameDraft} onChangeText={setFullNameDraft} style={styles.nameInput} accessibilityLabel="Nome completo" />
              </Card>
            ) : null}

            <Text style={styles.sectionTitle}>Conquistas</Text>
            {achievements.length ? (
              <FlatList horizontal data={achievements} keyExtractor={(item) => item.id} renderItem={({ item }) => <AchievementCard item={item} />} showsHorizontalScrollIndicator={false} />
            ) : <Text style={styles.emptyText}>Nenhuma conquista disponível.</Text>}

            <Card style={styles.aboutCard}>
              <Text style={styles.aboutTitle}>Sobre</Text>
              {isEditing ? (
                <>
                  <TextInput value={bioDraft} onChangeText={setBioDraft} maxLength={200} multiline numberOfLines={5} style={styles.bioInput} accessibilityLabel="Descrição sobre você" />
                  <Text style={styles.counter}>{bioDraft.length}/200</Text>
                </>
              ) : <Text style={styles.aboutText}>{profile.bio}</Text>}
              <View style={styles.tagsWrap}>
                {tagsDraft.length ? tagsDraft.map((tag) => <TagChip key={tag} label={tag} removable={isEditing} onRemove={() => setTagsDraft((current) => current.filter((item) => item !== tag))} />) : <Text style={styles.emptyText}>Nenhuma tag adicionada.</Text>}
              </View>
              {isEditing ? (
                <View style={styles.addTagRow}>
                  <TextInput value={newTag} onChangeText={setNewTag} placeholder="Nova tag" style={styles.tagInput} accessibilityLabel="Nova tag" />
                  <Pressable style={styles.addTagButton} onPress={addTag} accessibilityRole="button" accessibilityLabel="Adicionar tag"><Text style={styles.addTagText}>Adicionar</Text></Pressable>
                </View>
              ) : null}
            </Card>

            {isEditing ? (
              <View style={styles.profileActions}><Button title="Salvar" onPress={() => void saveProfile()} variant="accent" loading={saving} disabled={!fullNameDraft.trim()} /><Button title="Cancelar" onPress={cancelEditing} variant="outline" /></View>
            ) : (
              <View style={styles.profileActions}><Button title="Voltar para a tela inicial" onPress={onBack} variant="outline" icon={ArrowLeft} />{profile.isOwner ? <Button title="Sair da conta" onPress={confirmSignOut} variant="primary" icon={LogOut} /> : null}</View>
            )}

            <View style={styles.ratingsHeading}>
              <Text style={styles.sectionTitle}>{showAllReviews ? 'Todas as Avaliações' : 'Avaliações Recentes'}</Text>
              {reviews.length > 2 ? (
                <Pressable
                  style={styles.seeAllButton}
                  onPress={() => setShowAllReviews((current) => !current)}
                  accessibilityRole="button"
                  accessibilityLabel={showAllReviews ? 'Mostrar apenas avaliações recentes' : 'Ver todas as avaliações'}
                >
                  <Text style={styles.seeAll}>{showAllReviews ? 'Mostrar menos' : 'Ver todas'}</Text>
                </Pressable>
              ) : null}
            </View>
            {visibleReviews.length ? (
              <FlatList
                data={visibleReviews}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => <ReviewItem item={item} />}
                scrollEnabled={false}
              />
            ) : (
              <Text style={styles.emptyText}>Nenhuma avaliação recente.</Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, width: '100%', paddingBottom: 20 },
  headerBar: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 8 },
  backButton: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  profileIdentity: { alignItems: 'center', marginTop: -2 },
  avatarWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 112, height: 112, borderRadius: 56, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bold, color: colors.white, fontSize: 36 },
  editBadge: { position: 'absolute', right: 3, bottom: 5, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  name: { marginTop: 6, fontFamily: fonts.bold, fontSize: 25, color: colors.white },
  course: { marginTop: 4, fontFamily: fonts.regular, fontSize: 15, color: '#60A5FA' },
  ratingLine: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 5 },
  rating: { fontFamily: fonts.bold, fontSize: 16, color: '#60A5FA' },
  reviewCount: { fontFamily: fonts.medium, fontSize: 14, color: '#60A5FA' },
  bodyScroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  loader: { height: 180, alignItems: 'center', justifyContent: 'center' }, errorState: { gap: 12 },
  statsRow: { flexDirection: 'row', marginHorizontal: -4 },
  sectionTitle: { marginTop: 20, marginBottom: 12, fontFamily: fonts.bold, fontSize: 18, color: colors.primary },
  aboutCard: { marginTop: 18, padding: 18 }, aboutTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.primary },
  aboutText: { marginTop: 10, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.muted },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }, emptyText: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, paddingVertical: 8 },
  inputLabel: { marginTop: 12, marginBottom: 6, fontFamily: fonts.medium, fontSize: 13, color: colors.primary },
  nameInput: { height: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, color: colors.primary, fontFamily: fonts.regular },
  bioInput: { marginTop: 10, minHeight: 110, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, textAlignVertical: 'top', color: colors.primary, fontFamily: fonts.regular },
  counter: { marginTop: 4, textAlign: 'right', fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  addTagRow: { flexDirection: 'row', gap: 8, marginTop: 12 }, tagInput: { flex: 1, height: 42, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, fontFamily: fonts.regular },
  addTagButton: { height: 42, borderRadius: 10, backgroundColor: colors.accent, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, addTagText: { fontFamily: fonts.medium, fontSize: 12, color: colors.white },
  profileActions: { marginTop: 8, gap: 10 }, ratingsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seeAllButton: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  seeAll: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
});
