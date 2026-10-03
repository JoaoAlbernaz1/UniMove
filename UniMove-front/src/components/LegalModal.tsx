import { X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LegalDocument } from '../legal';
import { colors, fonts, maxContentWidth } from '../theme';
import { Button } from './Button';

type Props = {
  document: LegalDocument | null;
  onClose: () => void;
};

// Janela com os Termos de Uso ou a Política de Privacidade, aberta pelos links do cadastro.
export function LegalModal({ document, onClose }: Props) {
  return (
    <Modal
      visible={document !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.title} accessibilityRole="header">
              {document?.title}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Fechar">
              <X size={24} color={colors.primary} />
            </Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.content}>
            {document?.sections.map((section) => (
              <View key={section.heading} style={styles.section}>
                <Text style={styles.heading}>{section.heading}</Text>
                <Text style={styles.body}>{section.body}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <View style={styles.content}>
            <Button title="Entendi" onPress={onClose} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  headerRow: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 32, color: colors.primary },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  content: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', gap: 20 },
  section: { gap: 4 },
  heading: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, color: colors.primary },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, color: colors.muted },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
});
