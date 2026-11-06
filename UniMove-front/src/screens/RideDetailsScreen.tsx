import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { getRideDetails, requestRide, type RideDetails } from '../api/rides';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Message } from '../components/Message';
import { OpenFreeMap, type MapPoint } from '../components/OpenFreeMap';
import { colors, fonts, maxContentWidth } from '../theme';

export function RideDetailsScreen({
  rideId,
  onBack,
}: {
  rideId: string;
  onBack: () => void;
}) {
  const { authApi } = useAuth();
  const [ride, setRide] = useState<RideDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(
    () =>
      getRideDetails(authApi, rideId)
        .then((details) => {
          setRide(details);
          setSent(false);
          setError(null);
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar a carona.',
          );
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        }),
    [authApi, rideId],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (ride?.request?.status !== 'PENDING' && !sent) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' && !submittingRef.current)
        void load();
    }, 15000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !submittingRef.current) void load();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [load, ride?.request?.status, sent]);

  async function submit() {
    if (!ride?.canRequest || submittingRef.current || sent) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const request = await requestRide(authApi, rideId);
      setRide((current) =>
        current ? { ...current, canRequest: false, request } : current,
      );
      setSent(true);
      await load();
    } catch (cause) {
      // Refresh availability after a conflict, while keeping the original error visible.
      await load();
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível solicitar a carona.',
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const pending = sent || ride?.request?.status === 'PENDING';
  const confirmed = ride?.request?.reservation?.status === 'CONFIRMED';
  const points: MapPoint[] = ride
    ? [
        {
          ...ride.originLocation,
          label: ride.originLocation.name,
          kind: 'origin' as const,
        },
        {
          ...ride.destinationLocation,
          label: ride.destinationLocation.name,
          kind: 'destination' as const,
        },
      ].flatMap((point) =>
        point.latitude != null && point.longitude != null
          ? [{ ...point, latitude: point.latitude, longitude: point.longitude }]
          : [],
      )
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Voltar para buscar carona"
          style={styles.back}
        >
          <ArrowLeft color={colors.white} size={24} />
        </Pressable>
        <Text style={styles.headerTitle}>Detalhes da carona</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {error ? <Message tone="error">{error}</Message> : null}
        {!ride && !loading ? (
          <Button title="Tentar novamente" onPress={() => void load()} />
        ) : null}
        {ride ? (
          <>
            <Card style={styles.card}>
              <Text style={styles.title}>{ride.driver.fullName}</Text>
              <Text style={styles.body}>
                {ride.vehicle.brand} {ride.vehicle.model} · {ride.vehicle.color}{' '}
                · {ride.vehicle.year}
              </Text>
            </Card>
            <Card style={styles.card}>
              <Text style={styles.label}>Origem</Text>
              <Text style={styles.title}>{ride.originLocation.name}</Text>
              <Text style={styles.label}>Destino</Text>
              <Text style={styles.title}>{ride.destinationLocation.name}</Text>
              <Text style={styles.body}>
                {new Intl.DateTimeFormat('pt-BR', {
                  dateStyle: 'full',
                  timeStyle: 'short',
                }).format(new Date(ride.departureAt))}
              </Text>
              <Text style={styles.body}>
                {ride.availableSeats} vaga(s) disponível(is)
              </Text>
              <Text style={styles.title}>
                {new Intl.NumberFormat('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                }).format(ride.pricePerPersonCents / 100)}{' '}
                por pessoa
              </Text>
            </Card>
            <OpenFreeMap points={points} height={240} />
            <Card style={styles.card}>
              <Text style={styles.title}>Preferências</Text>
              <Text style={styles.body}>
                Bagagem: {ride.acceptsLuggage ? 'aceita' : 'não aceita'}
              </Text>
              <Text style={styles.body}>
                Música: {ride.allowsMusic ? 'permitida' : 'não permitida'}
              </Text>
              <Text style={styles.body}>
                Pets: {ride.acceptsPets ? 'aceita' : 'não aceita'}
              </Text>
              {ride.additionalInfo ? (
                <>
                  <Text style={styles.title}>Informações adicionais</Text>
                  <Text style={styles.body}>{ride.additionalInfo}</Text>
                </>
              ) : null}
            </Card>
          {ride.status === 'CANCELLED' ? (
            <Text style={styles.body}>Esta carona foi cancelada pelo motorista.</Text>
          ) : ride.request?.reservation?.status === 'COMPLETED' ? (
            <Message tone="success">Esta carona foi concluída. Consulte seu histórico de viagens.</Message>
          ) : pending ? (
              <Card style={styles.card}>
                <Text style={styles.title}>Aguardando motorista</Text>
                <Text style={styles.body}>
                  Solicitação enviada! Aguardando confirmação do motorista.
                </Text>
                {ride.request ? (
                  <Text style={styles.body}>
                    {ride.request.seatsRequested} vaga(s) bloqueada(s) até{' '}
                    {new Date(ride.request.expiresAt).toLocaleTimeString(
                      'pt-BR',
                      { hour: '2-digit', minute: '2-digit' },
                    )}
                    . Se não houver resposta, a solicitação expira.
                  </Text>
                ) : null}
              </Card>
            ) : confirmed ? (
              <Message tone="success">
                Sua vaga foi confirmada pelo motorista! Combine o ponto de
                encontro pelo chat em Mensagens.
              </Message>
            ) : ride.request?.status === 'REJECTED' ? (
              <Text style={styles.body}>
                O motorista recusou sua solicitação.
              </Text>
            ) : ride.request?.status === 'EXPIRED' ? (
              <Text style={styles.body}>
                Sua solicitação expirou e a vaga foi liberada. Você pode tentar
                novamente se houver disponibilidade.
              </Text>
            ) : null}
            {ride.canRequest && !pending ? (
              <>
                <Text style={styles.body}>
                  Você está solicitando uma vaga para você. Cada passageiro deve
                  ter sua própria conta cadastrada e verificada e enviar seu pedido.
                  O motorista precisa aceitar seu pedido para confirmar a
                  reserva. Combine os detalhes pelo chat, sem compartilhar seu
                  telefone.
                </Text>
                <Button
                  title="Solicitar carona"
                  onPress={() => void submit()}
                  loading={submitting}
                />
              </>
            ) : !pending && !confirmed ? (
              <Text style={styles.body}>
                {ride.isDriver
                  ? 'Esta carona foi publicada por você.'
                  : ride.hasPendingRequest
                    ? 'Você já tem uma solicitação aguardando o motorista. Aguarde a resposta ou a expiração antes de solicitar outra carona.'
                    : 'Esta carona não está disponível para novas solicitações.'}
              </Text>
            ) : null}
            <Button
              title="Atualizar status"
              variant="outline"
              disabled={submitting || refreshing}
              onPress={() => {
                setRefreshing(true);
                void load();
              }}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  back: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.white },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    padding: 20,
    gap: 16,
    paddingBottom: 32,
  },
  card: { padding: 18, gap: 10 },
  title: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary,
    lineHeight: 22,
  },
  label: { fontFamily: fonts.medium, fontSize: 12, color: colors.accentDark },
  body: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
  },
});
