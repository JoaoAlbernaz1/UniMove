import * as DocumentPicker from 'expo-document-picker';
import { CheckCircle2, FileText, X } from 'lucide-react-native';
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
import { TextField } from './TextField';
import {
  getIdentityVerificationStatus,
  sendIdentityVerificationCode,
  submitAcademicDocument,
  verifyInstitutionalEmail,
  type IdentityVerificationStatus,
} from '../services/identityVerificationService';
import { colors, fonts, maxContentWidth } from '../theme';

const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export function IdentityVerificationWizard({
  visible,
  email,
  onClose,
}: {
  visible: boolean;
  email: string;
  onClose: () => void;
}) {
  const { authApi } = useAuth();
  const [status, setStatus] = useState<IdentityVerificationStatus | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [code, setCode] = useState('');
  const [document, setDocument] =
    useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [submittingDocument, setSubmittingDocument] = useState(false);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(
    null,
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await getIdentityVerificationStatus(authApi);
      setStatus(current);
      setStep(current.emailVerified ? 2 : 1);
      setCurrentTime(Date.now());
      setResendAvailableAt(
        current.resendAvailableAt
          ? new Date(current.resendAvailableAt).getTime()
          : null,
      );
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

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const resendSeconds = resendAvailableAt
    ? Math.max(0, Math.ceil((resendAvailableAt - currentTime) / 1000))
    : 0;

  async function sendCode() {
    setSendingCode(true);
    setError(null);
    try {
      const result = await sendIdentityVerificationCode(authApi);
      setCurrentTime(Date.now());
      setResendAvailableAt(new Date(result.resendAvailableAt).getTime());
      setCode('');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível enviar o código. Tente novamente.',
      );
    } finally {
      setSendingCode(false);
    }
  }

  async function confirmCode() {
    if (code.length !== 6) {
      setError('Digite os 6 dígitos recebidos por e-mail.');
      return;
    }
    setVerifyingCode(true);
    setError(null);
    try {
      await verifyInstitutionalEmail(authApi, code);
      setCode('');
      await loadStatus();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível validar o código. Tente novamente.',
      );
    } finally {
      setVerifyingCode(false);
    }
  }

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
  const isBusy = loading || sendingCode || verifyingCode || submittingDocument;

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
          <Text style={styles.subtitle}>Etapa {step} de 2</Text>
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
            {step === 1 ? (
              <>
                <View style={styles.stepCard}>
                  <Text style={styles.stepTitle}>
                    1. Confirme seu e-mail institucional
                  </Text>
                  <Text style={styles.bodyText}>
                    Enviaremos um código de 6 dígitos para {email}. O código
                    expira em 10 minutos.
                  </Text>
                </View>
                {status?.emailVerified ? (
                  <>
                    <Message tone="success">
                      E-mail institucional verificado.
                    </Message>
                    <Button
                      title="Continuar para o comprovante"
                      onPress={() => setStep(2)}
                    />
                  </>
                ) : (
                  <>
                    <Button
                      title={
                        resendSeconds
                          ? `Aguarde ${resendSeconds}s para reenviar`
                          : 'Enviar código por e-mail'
                      }
                      onPress={() => void sendCode()}
                      loading={sendingCode}
                      disabled={resendSeconds > 0}
                    />
                    <TextField
                      label="Código de verificação"
                      value={code}
                      onChangeText={(value) => {
                        setCode(value.replace(/\D/g, '').slice(0, 6));
                        setError(null);
                      }}
                      keyboardType="number-pad"
                      maxLength={6}
                      placeholder="000000"
                      autoComplete="one-time-code"
                      editable={!isBusy}
                    />
                    <Button
                      title="Confirmar e continuar"
                      onPress={() => void confirmCode()}
                      loading={verifyingCode}
                      disabled={code.length !== 6}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <View style={styles.stepCard}>
                  <Text style={styles.stepTitle}>
                    2. Comprove seu vínculo acadêmico
                  </Text>
                  <Text style={styles.bodyText}>
                    Envie o PDF original da declaração. Vamos conferir nome,
                    matrícula, curso e código do relatório. O arquivo não será
                    guardado.
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
                  <Message tone="success">
                    Dados conferidos. A autenticidade está pendente de revisão
                    por um administrador do UniMove.
                  </Message>
                ) : (
                  <>
                    {academicStatus === 'REJECTED' &&
                    status?.academic?.reviewNote ? (
                      <Message tone="error">
                        Revisão anterior: {status.academic.reviewNote}
                      </Message>
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
              </>
            )}
          </ScrollView>
        )}
        {step === 2 && status?.emailVerified ? (
          <View style={styles.footer}>
            <Button
              title="Voltar para o e-mail"
              variant="outline"
              onPress={() => setStep(1)}
            />
          </View>
        ) : null}
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
  footer: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  pressed: { opacity: 0.8 },
});
