import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ArrowLeft } from 'lucide-react-native';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Message } from '../components/Message';
import { colors, fonts, maxContentWidth } from '../theme';

type DriverRequest = {
  id: string;
  rideId: string;
  status: string;
  reservation?: { status: string } | null;
  seatsRequested: number;
  expiresAt: string;
  passenger: { fullName: string };
  ride: {
    status?: string;
    departureAt: string;
    driver?: { fullName: string };
    originLocation: { name: string };
    destinationLocation: { name: string };
  };
};

export function RideRequestsScreen({
  onBack,
  mode,
  onViewRide,
}: {
  onBack: () => void;
  mode: 'driver' | 'passenger';
  onViewRide?: (rideId: string) => void;
}) {
  const { authApi } = useAuth();
  const [requests, setRequests] = useState<DriverRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const actionRef = useRef(false);
  const load = useCallback(
    () =>
      authApi<DriverRequest[]>(
        mode === 'driver'
          ? '/driver/ride-requests?status=PENDING'
          : '/rides/requests/mine',
      )
        .then((items) => {
          setRequests(items);
          setError(null);
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar os pedidos.',
          );
        })
        .finally(() => setLoading(false)),
    [authApi, mode],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function respond(id: string, action: 'accept' | 'reject') {
    if (actionRef.current) return;
    actionRef.current = true;
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await authApi(`/ride-requests/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
      });
      setNotice(
        action === 'accept'
          ? 'Reserva confirmada! O passageiro foi notificado e o chat está disponível em Mensagens.'
          : 'Solicitação recusada. A vaga foi liberada.',
      );
      await load();
    } catch (cause) {
      await load();
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível responder à solicitação.',
      );
    } finally {
      setBusyId(null);
      actionRef.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          style={styles.back}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Voltar para início"
        >
          <ArrowLeft size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {mode === 'driver' ? 'Pedidos de carona' : 'Minhas solicitações'}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              setLoading(true);
              void load();
            }}
          />
        }
      >
        {error ? <Message tone="error">{error}</Message> : null}
        {notice ? <Message tone="success">{notice}</Message> : null}
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {!loading && !error && !requests.length ? (
          <Text style={styles.body}>
            {mode === 'driver'
              ? 'Você não tem solicitações pendentes. Os novos pedidos dos passageiros aparecerão aqui.'
              : 'Você ainda não solicitou caronas. Encontre um trajeto e envie seu pedido.'}
          </Text>
        ) : null}
        {requests.map((item) => (
          <Card key={item.id} style={styles.card}>
            <Text style={styles.title}>
              {mode === 'driver'
                ? item.passenger.fullName
                : item.ride.driver?.fullName}
            </Text>
            <Text style={styles.body}>
              {item.ride.originLocation.name} →{' '}
              {item.ride.destinationLocation.name}
            </Text>
            <Text style={styles.body}>
              {new Date(item.ride.departureAt).toLocaleString('pt-BR')} ·{' '}
              {item.seatsRequested} vaga(s)
            </Text>
            {mode === 'driver' ? (
              <>
                <Text style={styles.body}>
                  Responder até{' '}
                  {new Date(item.expiresAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <Button
                  title="Aceitar solicitação"
                  disabled={busyId !== null}
                  loading={busyId === item.id}
                  onPress={() => void respond(item.id, 'accept')}
                />
                <Button
                  title="Recusar"
                  variant="outline"
                  disabled={busyId !== null}
                  onPress={() => void respond(item.id, 'reject')}
                />
              </>
            ) : (
              <>
                <Text style={styles.title}>
                  {item.ride.status === 'CANCELLED'
                    ? 'Carona cancelada'
                    : item.reservation?.status === 'COMPLETED'
                    ? 'Carona concluída'
                    : item.reservation?.status === 'CANCELLED'
                    ? 'Reserva cancelada'
                    : ({
                        PENDING: 'Aguardando motorista',
                        ACCEPTED: 'Aceita pelo motorista',
                        REJECTED: 'Recusada',
                        EXPIRED: 'Expirada',
                        CANCELLED: 'Cancelada',
                      }[item.status] ?? item.status)}
                </Text>
                <Button
                  title="Ver detalhes"
                  variant="outline"
                  onPress={() => onViewRide?.(item.rideId)}
                />
              </>
            )}
          </Card>
        ))}
        <Button
          title="Atualizar pedidos"
          variant="outline"
          disabled={loading || busyId !== null}
          onPress={() => {
            setLoading(true);
            void load();
          }}
        />
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
    padding: 16,
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
  },
  card: { padding: 18, gap: 12 },
  title: { fontFamily: fonts.bold, fontSize: 15, color: colors.primary },
  body: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },
});
