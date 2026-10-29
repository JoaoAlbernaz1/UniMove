import { GraduationCap, Leaf, ShieldCheck, UsersRound, ArrowRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { registrationPolicy } from '../api/auth';
import { LegalModal } from '../components/LegalModal';
import { BenefitCard } from '../components/welcome/BenefitCard';
import { PrimaryButton } from '../components/welcome/PrimaryButton';
import { StatsBanner } from '../components/welcome/StatsBanner';
import { WelcomeHeader } from '../components/welcome/WelcomeHeader';
import type { LegalDocument } from '../legal';
import { colors, fonts, maxContentWidth, radius } from '../theme';

type Benefit = { icon: LucideIcon; title: string; description: string };

const benefits: readonly Benefit[] = [
  { icon: ShieldCheck, title: 'Caronas Seguras', description: 'Viaje com tranquilidade. Todos os usuários são verificados e avaliados pela comunidade.' },
  { icon: GraduationCap, title: 'Verificação Acadêmica', description: 'Conecte-se com estudantes da sua universidade por meio de contas verificadas.' },
  { icon: UsersRound, title: 'Comunidade Universitária', description: 'Encontre pessoas da sua faculdade, compartilhe caminhos e faça novas amizades.' },
];

const stats = [
  { value: '50K+', label: 'Usuários' },
  { value: '200+', label: 'Universidades' },
  { value: '1M+', label: 'Caronas' },
];

export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  const insets = useSafeAreaInsets();
  const [terms, setTerms] = useState<LegalDocument | null>(null);
  const [termsError, setTermsError] = useState(false);

  async function openTerms() {
    try {
      const policy = await registrationPolicy();
      setTerms(policy.termsOfUse);
      setTermsError(false);
    } catch {
      setTermsError(true);
    }
  }

  return (
    <View style={styles.root}>
      <WelcomeHeader topInset={insets.top} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {benefits.map((benefit) => <BenefitCard key={benefit.title} {...benefit} />)}
          <View style={styles.ecoCard}>
            <View style={styles.ecoIcon}><Leaf size={27} color={colors.accent} /></View>
            <View style={styles.ecoCopy}><Text style={styles.ecoTitle}>Economize e Ajude o Planeta</Text><Text style={styles.ecoDescription}>Reduza gastos com transporte e diminua a emissão de carbono compartilhando viagens.</Text></View>
          </View>
          <StatsBanner stats={stats} />
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}> 
        <View style={styles.footerContent}>
          <PrimaryButton title="Começar" onPress={onStart} icon={ArrowRight} />
          <Text style={styles.agreement}>Ao continuar, você concorda com nossos{' '}<Pressable onPress={openTerms} accessibilityRole="link"><Text style={styles.terms}>Termos de Uso</Text></Pressable></Text>
          {termsError ? <Text style={styles.error}>Não foi possível carregar os termos.</Text> : null}
        </View>
      </View>
      <LegalModal document={terms} onClose={() => setTerms(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  ecoCard: { minHeight: 118, borderRadius: radius, borderWidth: 1, borderColor: '#BBF7D0', backgroundColor: '#F0FDF4', flexDirection: 'row', alignItems: 'center', padding: 18, marginBottom: 12 },
  ecoIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  ecoCopy: { flex: 1 },
  ecoTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 23, color: colors.primary },
  ecoDescription: { marginTop: 4, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
  footer: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 20, paddingTop: 14 },
  footerContent: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  agreement: { marginTop: 10, textAlign: 'center', fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.muted },
  terms: { fontFamily: fonts.medium, color: colors.accent },
  error: { marginTop: 6, textAlign: 'center', fontFamily: fonts.regular, fontSize: 12, color: colors.destructive },
});
