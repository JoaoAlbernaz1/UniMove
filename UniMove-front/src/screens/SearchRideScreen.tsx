import {
  ArrowLeft,
  Circle,
  MapPin,
  SlidersHorizontal,
  Star,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { formatRideDate, formatRideTime } from '../offerRide';
import { OpenFreeMap, type MapPoint } from '../components/OpenFreeMap';
import { colors, fonts, maxContentWidth } from '../theme';

type Ride = {
  id: string;
  departureAt: string;
  status: 'SCHEDULED' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  availableSeats: number;
  pricePerPersonCents: number;
  originLocation: { name: string; latitude?: number | null; longitude?: number | null };
  destinationLocation: { name: string; latitude?: number | null; longitude?: number | null };
  driver: {
    id: string;
    fullName: string;
    ratingAverage: number | null;
    ratingCount: number;
  };
  vehicle?: { brand: string; model: string };
};

export function SearchRideScreen({ onBack }: { onBack?: () => void }) {
  const { authApi } = useAuth();

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [timeFilter, setTimeFilter] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  const [displayedRides, setDisplayedRides] = useState<Ride[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A API aplica os filtros e devolve uma página já ordenada.
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (origin.trim()) params.set('origin', origin);
      if (destination.trim()) params.set('destination', destination);
      if (dateFilter) params.set('date', dateFilter);
      if (timeFilter) params.set('time', timeFilter);
      authApi<{ items: Ride[]; total: number }>(`/rides?${params}`)
        .then((response) => {
          if (active) {
            setDisplayedRides(response.items);
            setTotal(response.total);
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setDisplayedRides([]);
            setTotal(0);
            setError(
              cause instanceof Error
                ? cause.message
                : 'Erro ao buscar caronas.',
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [authApi, origin, destination, dateFilter, timeFilter, page]);

  function clearFilters() {
    setOrigin('');
    setDestination('');
    setDateFilter('');
    setTimeFilter('');
    setPage(1);
  }

  // Funções auxiliares para formatar data e hora
  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    const dayMonth = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
    })
      .format(date)
      .replace('.', '');
    const time = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
    return { dayMonth, time };
  };

  const mapPoints: MapPoint[] = displayedRides.flatMap((ride) => {
    const points: MapPoint[] = [];
    if (ride.originLocation.latitude != null && ride.originLocation.longitude != null) {
      points.push({ latitude: ride.originLocation.latitude, longitude: ride.originLocation.longitude, label: ride.originLocation.name, kind: 'origin' });
    }
    if (ride.destinationLocation.latitude != null && ride.destinationLocation.longitude != null) {
      points.push({ latitude: ride.destinationLocation.latitude, longitude: ride.destinationLocation.longitude, label: ride.destinationLocation.name, kind: 'destination' });
    }
    return points;
  });

  const getInitials = (name: string) => {
    return name
      .trim()
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.keyboardView}>
        {/* HEADER ESCURO COM FILTROS */}
        <View style={styles.darkHeader}>
          <View style={styles.headerTopRow}>
            <Pressable
              onPress={onBack}
              style={styles.backButton}
              accessibilityRole="button"
            >
              <ArrowLeft size={24} color={colors.white} />
            </Pressable>
            <Text style={styles.headerTitle}>Buscar Carona</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.inputsContainer}>
            <View style={styles.inputWrapper}>
              <Circle
                size={14}
                color="#00D159"
                fill="#00D159"
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Centro"
                accessibilityLabel="Filtrar por origem"
                placeholderTextColor="#94A3B8"
                value={origin}
                onChangeText={(value) => {
                  setOrigin(value);
                  setPage(1);
                }}
              />
            </View>

            <View style={styles.inputWrapper}>
              <MapPin size={16} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Campus Norte"
                accessibilityLabel="Filtrar por destino"
                placeholderTextColor="#94A3B8"
                value={destination}
                onChangeText={(value) => {
                  setDestination(value);
                  setPage(1);
                }}
              />
            </View>

            <View style={styles.rowInputs}>
              <View style={[styles.inputWrapper, { flex: 1 }]}>
                <TextInput
                  style={styles.input}
                  placeholder="dd/mm/aaaa"
                  accessibilityLabel="Filtrar por data de saída, no formato dd/mm/aaaa"
                  placeholderTextColor="#94A3B8"
                  value={dateFilter}
                  onChangeText={(value) => {
                    setDateFilter(formatRideDate(value));
                    setPage(1);
                  }}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
              <View style={[styles.inputWrapper, { flex: 1 }]}>
                <TextInput
                  style={styles.input}
                  placeholder="08:00"
                  accessibilityLabel="Filtrar pelo horário exato de saída, no formato HH:mm"
                  placeholderTextColor="#94A3B8"
                  value={timeFilter}
                  onChangeText={(value) => {
                    setTimeFilter(formatRideTime(value));
                    setPage(1);
                  }}
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
            </View>
          </View>
        </View>

        {/* ÁREA BRANCA DE RESULTADOS */}
        <View style={styles.contentWrapper}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsCount}>
                {loading
                  ? 'Buscando...'
                  : `${total} ${total === 1 ? 'carona encontrada' : 'caronas encontradas'}`}
              </Text>
              <Pressable
                style={styles.filterButton}
                onPress={clearFilters}
                accessibilityRole="button"
                accessibilityLabel="Limpar filtros"
              >
                <SlidersHorizontal size={14} color={colors.primary} />
                <Text style={styles.filterButtonText}>Limpar</Text>
              </Pressable>
            </View>

            <View style={styles.viewSwitch}>
              <Pressable style={[styles.viewButton, viewMode === 'list' && styles.viewButtonActive]} onPress={() => setViewMode('list')} accessibilityRole="button" accessibilityLabel="Mostrar resultados em lista">
                <Text style={[styles.viewButtonText, viewMode === 'list' && styles.viewButtonTextActive]}>Lista</Text>
              </Pressable>
              <Pressable style={[styles.viewButton, viewMode === 'map' && styles.viewButtonActive]} onPress={() => setViewMode('map')} accessibilityRole="button" accessibilityLabel="Mostrar resultados no mapa">
                <Text style={[styles.viewButtonText, viewMode === 'map' && styles.viewButtonTextActive]}>Mapa</Text>
              </Pressable>
            </View>

            {viewMode === 'map' ? <View style={styles.mapContainer}><OpenFreeMap points={mapPoints} height={360} /></View> : null}

            {viewMode === 'list' && total > pageSize && !loading && !error ? (
              <View style={styles.resultsHeader}>
                <Pressable
                  onPress={() => setPage((value) => value - 1)}
                  disabled={page === 1}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: page === 1 }}
                  style={styles.filterButton}
                >
                  <Text style={styles.filterButtonText}>Anterior</Text>
                </Pressable>
                <Text style={styles.resultsCount}>
                  Página {page} de {Math.ceil(total / pageSize)}
                </Text>
                <Pressable
                  onPress={() => setPage((value) => value + 1)}
                  disabled={page * pageSize >= total}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: page * pageSize >= total }}
                  style={styles.filterButton}
                >
                  <Text style={styles.filterButtonText}>Próxima</Text>
                </Pressable>
              </View>
            ) : null}

            {viewMode === 'list' && loading ? (
              <View style={styles.stateContainer}>
                <ActivityIndicator color={colors.primary} size="large" />
              </View>
            ) : viewMode === 'list' && error ? (
              <View style={styles.stateContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : viewMode === 'list' && displayedRides.length === 0 ? (
              <View style={styles.stateContainer}>
                <Text style={styles.emptyText}>
                  Nenhuma carona encontrada para os filtros informados.
                </Text>
              </View>
            ) : viewMode === 'list' ? (
              <View style={styles.rideList}>
                {displayedRides.map((ride) => {
                  const { dayMonth, time } = formatDateTime(ride.departureAt);
                  const carModel = ride.vehicle
                    ? `${ride.vehicle.brand} ${ride.vehicle.model}`
                    : 'Veículo padrão';

                  return (
                    <View key={ride.id} style={styles.card}>
                      {/* HEADER DO CARD */}
                      <View style={styles.cardHeader}>
                        <View style={styles.driverInfo}>
                          <View style={styles.avatar}>
                            <Text style={styles.avatarText}>
                              {getInitials(ride.driver.fullName)}
                            </Text>
                          </View>
                          <View style={styles.driverCopy}>
                            <Text style={styles.driverName} numberOfLines={1}>
                              {ride.driver.fullName}
                            </Text>
                            <View style={styles.ratingRow}>
                              <Star size={12} color="#00D159" fill="#00D159" />
                              <Text style={styles.ratingText}>
                                {ride.driver.ratingAverage === null
                                  ? 'Sem avaliações'
                                  : new Intl.NumberFormat('pt-BR', {
                                      maximumFractionDigits: 1,
                                    }).format(ride.driver.ratingAverage)}
                              </Text>
                              <Text style={styles.carText} numberOfLines={1}>
                                {carModel}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <View style={styles.priceContainer}>
                          <Text style={styles.priceValue}>
                            {ride.pricePerPersonCents > 0
                              ? new Intl.NumberFormat('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                                }).format(ride.pricePerPersonCents / 100)
                              : 'Solidária'}
                          </Text>
                          <Text style={styles.priceLabel}>por pessoa</Text>
                        </View>
                      </View>

                      {/* ROTA */}
                      <View style={styles.routeContainer}>
                        <View style={styles.routeTimeline}>
                          <View style={styles.dotOrigin} />
                          <View style={styles.line} />
                          <MapPin
                            size={14}
                            color={colors.primary}
                            style={styles.pinDest}
                          />
                        </View>
                        <View style={styles.routeDetails}>
                          <View style={styles.originBlock}>
                            <Text style={styles.locationName}>
                              {ride.originLocation.name}
                            </Text>
                            <Text style={styles.dateTimeText}>
                              {dayMonth} • {time}
                            </Text>
                          </View>
                          <View style={styles.destBlock}>
                            <Text style={styles.locationName}>
                              {ride.destinationLocation.name}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.divider} />

                      {/* FOOTER DO CARD */}
                      <View style={styles.cardFooter}>
                        <Text style={styles.seatsText}>
                          {ride.availableSeats}{' '}
                          {ride.availableSeats === 1
                            ? 'vaga disponível'
                            : 'vagas disponíveis'}
                        </Text>
                        <Pressable style={styles.reserveButton}>
                          <Text style={styles.reserveButtonText}>Reservar</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  keyboardView: { flex: 1 },

  // Estilos do Header Escuro
  darkHeader: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    alignItems: 'center',
  },
  headerTopRow: {
    width: '100%',
    maxWidth: maxContentWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backButton: { padding: 8, marginLeft: -8 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.white },

  inputsContainer: {
    width: '100%',
    maxWidth: maxContentWidth,
    gap: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 16,
  },
  rowInputs: {
    flexDirection: 'row',
    gap: 12,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.foreground,
    height: '100%',
  },

  // Área de Resultados (Branca)
  contentWrapper: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 32,
    alignItems: 'center',
  },
  resultsHeader: {
    width: '100%',
    maxWidth: maxContentWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  viewSwitch: {
    width: '100%',
    maxWidth: maxContentWidth,
    flexDirection: 'row',
    backgroundColor: '#E9EEF5',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  viewButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    borderRadius: 8,
  },
  viewButtonActive: { backgroundColor: colors.white },
  viewButtonText: { fontFamily: fonts.medium, fontSize: 13, color: '#64748B' },
  viewButtonTextActive: { color: colors.primary },
  mapContainer: { width: '100%', maxWidth: maxContentWidth, marginBottom: 16 },
  resultsCount: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#64748B',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  filterButtonText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.primary,
  },

  // Estilos do Card (Fiel à Imagem)
  rideList: {
    width: '100%',
    maxWidth: maxContentWidth,
    gap: 16,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  driverInfo: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverCopy: { flex: 1, minWidth: 0 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00D159',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.white,
  },
  driverName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary,
    marginBottom: 2,
  },
  ratingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#64748B',
    marginRight: 6,
  },
  carText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#94A3B8',
  },
  priceContainer: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  priceValue: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#00D159',
  },
  priceLabel: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: '#94A3B8',
  },

  routeContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  routeTimeline: {
    alignItems: 'center',
    marginRight: 12,
    marginTop: 4,
  },
  dotOrigin: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#00D159',
    backgroundColor: colors.white,
  },
  line: {
    width: 1,
    height: 28,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  pinDest: {
    marginLeft: -1,
  },
  routeDetails: {
    flex: 1,
    justifyContent: 'space-between',
  },
  originBlock: {
    height: 40,
  },
  destBlock: {
    height: 20,
    justifyContent: 'flex-end',
  },
  locationName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  dateTimeText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },

  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginBottom: 16,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seatsText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#64748B',
  },
  reserveButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  reserveButtonText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.white,
  },

  stateContainer: {
    marginTop: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#64748B',
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#EF4444',
  },
});
