import { CarFront } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../../theme';

export function WelcomeHeader({ topInset }: { topInset: number }) {
  return (
    <View style={[styles.header, { paddingTop: topInset + 32 }]}>
      <View style={styles.logo}><CarFront size={38} color={colors.white} strokeWidth={1.8} /></View>
      <Text style={styles.appName}>UniMove</Text>
      <Text style={styles.subtitle}>A rede de caronas da sua universidade</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.primary, alignItems: 'center', paddingBottom: 28 },
  logo: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#21C55D', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  appName: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, color: colors.white },
  subtitle: { marginTop: 4, fontFamily: fonts.regular, fontSize: 14, color: '#AFC9F9' },
});
