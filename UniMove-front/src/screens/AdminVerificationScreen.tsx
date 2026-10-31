import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ExternalLink } from 'lucide-react-native';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { colors, fonts, maxContentWidth } from '../theme';

const REPORT_VERIFIER_URL =
  'https://portalacademico.ubec.edu.br/Corpore.Net/Source/Rpt-GeradorRelatoriosNet/RM.Rpt.Reports/Anonymous/RptFindReportByGuid.aspx';

type PendingVerification = {
  userId: string;
  reportGuid: string;
  status: 'PENDING_REVIEW';
  submittedAt: string;
  user: {
    fullName: string;
    institutionalEmail: string;
    studentNumber: string | null;
    course: string | null;
  };
};

export function AdminVerificationScreen({ onBack }: { onBack: () => void }) {
  const { authApi } = useAuth();
  const [items, setItems] = useState<PendingVerification[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewingUserId, setReviewingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setError(null);
    try {
      const result = await authApi<PendingVerification[]>(
        '/admin/academic-verifications?page=1&limit=50',
      );
      setItems(result);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível carregar as validações pendentes.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authApi]);

  useEffect(() => {
    const timer = setTimeout(() => void loadItems(), 0);
    return () => clearTimeout(timer);
  }, [loadItems]);

  async function review(
    item: PendingVerification,
    status: 'APPROVED' | 'REJECTED',
  ) {
    const reviewNote = notes[item.userId]?.trim();
    if (status === 'REJECTED' && !reviewNote) {
      setError('Informe o motivo antes de rejeitar o comprovante.');
      return;
    }
    setReviewingUserId(item.userId);
    setError(null);
    setNotice(null);
    try {
      await authApi(`/admin/academic-verifications/${item.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(reviewNote ? { reviewNote } : {}) }),
      });
      setNotice(
        status === 'APPROVED'
          ? 'Comprovante aprovado.'
          : 'Comprovante rejeitado.',
      );
      await loadItems();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível registrar a revisão.',
      );
    } finally {
      setReviewingUserId(null);
    }
  }

  async function openVerifier() {
    try {
      await Linking.openURL(REPORT_VERIFIER_URL);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível abrir o portal oficial.',
      );
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Voltar para Configurações"
        >
          <ArrowLeft size={22} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Revisões cadastrais</Text>
      </View>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadItems();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <Text style={styles.description}>
          Abra o validador oficial, informe o código do relatório e compare
          nome, matrícula e curso antes de aprovar.
        </Text>
        <Button
          title="Abrir validador oficial TOTVS"
          variant="outline"
          icon={ExternalLink}
          onPress={() => void openVerifier()}
        />
        {notice ? <Message tone="success">{notice}</Message> : null}
        {error ? <Message tone="error">{error}</Message> : null}
        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.description}>Carregando solicitações...</Text>
          </View>
        ) : items.length ? (
          items.map((item) => (
            <View key={item.userId} style={styles.card}>
              <Text style={styles.name}>{item.user.fullName}</Text>
              <Text style={styles.detail}>{item.user.institutionalEmail}</Text>
              <Text style={styles.detail}>
                Matrícula: {item.user.studentNumber ?? 'Não informada'}
              </Text>
              <Text style={styles.detail}>
                Curso: {item.user.course ?? 'Não informado'}
              </Text>
              <Text style={styles.detail}>Código do relatório:</Text>
              <Text selectable style={styles.reportGuid}>
                {item.reportGuid}
              </Text>
              <Text style={styles.detail}>
                Enviado em {new Date(item.submittedAt).toLocaleString('pt-BR')}
              </Text>
              <TextInput
                value={notes[item.userId] ?? ''}
                onChangeText={(value) =>
                  setNotes((current) => ({ ...current, [item.userId]: value }))
                }
                placeholder="Observação ou motivo da rejeição"
                placeholderTextColor={colors.muted}
                maxLength={500}
                multiline
                editable={reviewingUserId !== item.userId}
                style={styles.noteInput}
                accessibilityLabel={`Observação da solicitação de ${item.user.fullName}`}
              />
              <View style={styles.actions}>
                <Button
                  title="Aprovar"
                  variant="accent"
                  onPress={() => void review(item, 'APPROVED')}
                  loading={reviewingUserId === item.userId}
                  disabled={reviewingUserId !== null}
                />
                <Button
                  title="Rejeitar"
                  variant="outline"
                  onPress={() => void review(item, 'REJECTED')}
                  disabled={
                    reviewingUserId !== null || !notes[item.userId]?.trim()
                  }
                />
              </View>
            </View>
          ))
        ) : (
          <View style={styles.state}>
            <Text style={styles.empty}>Nenhuma validação pendente.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
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
  backButton: { width: 42, height: 48, justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.white },
  body: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    gap: 14,
    padding: 18,
    paddingBottom: 32,
  },
  description: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  state: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 28,
  },
  empty: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  card: {
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.primary },
  detail: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  reportGuid: {
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 20,
    color: colors.primary,
  },
  noteInput: {
    minHeight: 76,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.primary,
    textAlignVertical: 'top',
  },
  actions: { gap: 8 },
});
