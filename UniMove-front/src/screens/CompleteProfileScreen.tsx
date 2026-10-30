import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { ProfileDetailsForm } from '../components/ProfileDetailsForm';
import { Button } from '../components/Button';
import type { Profile } from '../services/profileService';
import { colors, fonts, maxContentWidth } from '../theme';

export function CompleteProfileScreen({
  profile,
  onCompleted,
}: {
  profile: Profile;
  onCompleted: (profile: Profile) => void;
}) {
  const { signOut } = useAuth();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Complete seu perfil
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Text style={styles.description}>
            Antes de começar, conte um pouco sobre você para a comunidade.
          </Text>
          <ProfileDetailsForm initial={profile} onSaved={onCompleted} />
          <Button
            title="Sair da conta"
            variant="outline"
            onPress={() => void signOut()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  header: {
    minHeight: 60,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  content: { width: '100%', maxWidth: maxContentWidth, padding: 24, gap: 24 },
  description: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
  },
});
