import * as DocumentPicker from 'expo-document-picker';
import { CheckCircle2, Clock3, FileText, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { Button } from './Button';
import { Message } from './Message';
import {
  getIdentityVerificationStatus,
  submitAcademicDocument,
  type IdentityVerificationStatus,
} from '../services/identityVerificationService';
import { colors, fonts, maxContentWidth } from '../theme';

const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export function IdentityVerificationWizard({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { authApi } = useAuth();
  const [status, setStatus] = useState<IdentityVerificationStatus | null>(null);
  const [document, setDocument] =
    useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [loading, setLoading] = useState(false);
  const [submittingDocument, setSubmittingDocument] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await getIdentityVerificationStatus(authApi);
      setStatus(current);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível carregar o status da validação.',
      );
    } finally {
      setLoading(false);
    }
  }, [authApi]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => void loadStatus(), 0);
    return () => clearTimeout(timer);
  }, [loadStatus, visible]);

  async function chooseDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const selected = result.assets[0];
      if (
        selected.mimeType !== 'application/pdf' &&
        !selected.name.toLowerCase().endsWith('.pdf')
      ) {
        setError('Selecione um arquivo PDF.');
        return;
      }
      if (selected.size !== undefined && selected.size > DOCUMENT_MAX_BYTES) {
        setError('O comprovante deve ter até 5 MB.');
        return;
      }
      setDocument(selected);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível abrir os arquivos do dispositivo.',
      );
    }
  }

  async function sendDocument() {
    if (!document || submittingDocument) return;
    setSubmittingDocument(true);
    setError(null);
    try {
      await submitAcademicDocument(authApi, document);
      setDocument(null);
      await loadStatus();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível validar o comprovante. Tente novamente.',
      );
    } finally {
      setSubmittingDocument(false);
    }
  }

  const academicStatus = status?.academic?.status;
  const isBusy = loading || submittingDocument;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header">
              Validação cadastral
            </Text>
            <Pressable
              onPress={onClose}
              disabled={isBusy}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Fechar"
            >
              <X size={24} color={colors.primary} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            Envie seu comprovante de matrícula
          </Text>
        </View>

        {loading && !status ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.bodyText}>Carregando status...</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {error ? <Message tone="error">{error}</Message> : null}
            <View style={styles.stepCard}>
              <Text style={styles.stepTitle}>
                {academicStatus === 'APPROVED'
                  ? 'Validação concluída'
                  : academicStatus === 'PENDING_REVIEW'
                    ? 'Documento recebido'
                    : academicStatus === 'REJECTED'
                      ? 'Ajuste necessário'
                      : 'Comprove seu vínculo acadêmico'}
              </Text>
              <Text style={styles.bodyText}>
                Envie o PDF original da declaração. O sistema confere os dados
                do documento e a equipe UniMove revisa a autenticidade. O
                arquivo não será guardado.
              </Text>
            </View>
            {academicStatus === 'APPROVED' ? (
              <View style={styles.statusCard}>
                <CheckCircle2 size={22} color={colors.accentDark} />
                <View style={styles.statusText}>
                  <Text style={styles.stepTitle}>Cadastro validado</Text>
                  <Text style={styles.bodyText}>
                    O comprovante foi conferido no portal oficial por um
                    administrador.
                  </Text>
                </View>
              </View>
            ) : academicStatus === 'PENDING_REVIEW' ? (
              <View style={styles.statusCard}>
                <Clock3 size={22} color={colors.accentDark} />
                <View style={styles.statusText}>
                  <Text style={styles.stepTitle}>Em análise</Text>
                  <Text style={styles.bodyText}>
                    Seus dados foram conferidos e o comprovante aguarda revisão
                    da equipe. Você não precisa enviar novamente.
                    {status?.academic?.submittedAt
                      ? ` Enviado em ${new Date(
                          status.academic.submittedAt,
                        ).toLocaleDateString('pt-BR')}.`
                      : ''}
                  </Text>
                </View>
              </View>
            ) : (
              <>
                {academicStatus === 'REJECTED' ? (
                  <>
                    {status?.academic?.reviewNote ? (
                      <Message tone="error">
                        Motivo informado pela equipe: {status.academic.reviewNote}
                      </Message>
                    ) : null}
                    <View style={styles.stepCard}>
                      <Text style={styles.bodyText}>
                        Confira o motivo da rejeição, escolha um novo
                        comprovante em PDF e envie novamente para análise.
                      </Text>
                    </View>
                  </>
                ) : null}
                <Pressable
                  onPress={() => void chooseDocument()}
                  disabled={isBusy}
                  style={({ pressed }) => [
                    styles.documentPicker,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                >
                  <FileText size={22} color={colors.primary} />
                  <Text style={styles.documentName}>
                    {document?.name ?? 'Escolher comprovante em PDF'}
                  </Text>
                </Pressable>
                <Button
                  title="Enviar para validação"
                  onPress={() => void sendDocument()}
                  loading={submittingDocument}
                  disabled={!document}
                />
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 23,
    lineHeight: 30,
    color: colors.primary,
  },
  subtitle: {
    marginTop: 6,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.accentDark,
  },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stepCard: {
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  stepTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 21,
    color: colors.primary,
  },
  bodyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  documentPicker: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  documentName: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.primary,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.accentBg,
  },
  statusText: { flex: 1, gap: 4 },
  pressed: { opacity: 0.8 },
});
