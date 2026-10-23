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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { colors, fonts, maxContentWidth } from '../theme';

type Ride = {
  id: string;
  departureAt: string;
  status: 'SCHEDULED' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  availableSeats: number;
  originLocation: { name: string };
  destinationLocation: { name: string };
  driver: { id: string; fullName: string };
  vehicle?: { brand: string; model: string };
};

export function SearchRideScreen({ onBack }: { onBack?: () => void }) {
  const { authApi } = useAuth();

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [timeFilter, setTimeFilter] = useState('');

  const [allRides, setAllRides] = useState<Ride[]>([]);
  const [displayedRides, setDisplayedRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Busca inicial automática ao abrir a tela
  useEffect(() => {
    const fetchRides = async () => {
      try {
        setLoading(true);
        // Busca as caronas na API. (Ajuste a rota conforme seu backend, caso seja diferente)
        const response = await authApi<Ride[]>('/rides');
        setAllRides(response || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao buscar caronas.');
      } finally {
        setLoading(false);
      }
    };

    void fetchRides();
  }, [authApi]);

  // Lógica de Filtro e Limite de 10 caronas
  useEffect(() => {
    let filtered = allRides.filter(
      (ride) => ride.status === 'OPEN' || ride.status === 'SCHEDULED'
    );

    if (origin) {
      filtered = filtered.filter((r) =>
        r.originLocation.name.toLowerCase().includes(origin.toLowerCase())
      );
    }
    if (destination) {
      filtered = filtered.filter((r) =>
        r.destinationLocation.name.toLowerCase().includes(destination.toLowerCase())
      );
    }

    // Ordena pela data de saída mais próxima (ou pode inverter para createdAt, se preferir)
    filtered.sort(
      (a, b) => new Date(a.departureAt).getTime() - new Date(b.departureAt).getTime()
    );

    // Limita a exibição às 10 primeiras
    setDisplayedRides(filtered.slice(0, 10));
  }, [origin, destination, allRides]);

  // Funções auxiliares para formatar data e hora
  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date).replace('.', '');
    const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
    return { dayMonth, time };
  };

  const getInitials = (name: string) => {
    return name.trim().split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        
        {/* HEADER ESCURO COM FILTROS */}
        <View style={styles.darkHeader}>
          <View style={styles.headerTopRow}>
            <Pressable onPress={onBack} style={styles.backButton} accessibilityRole="button">
              <ArrowLeft size={24} color={colors.white} />
            </Pressable>
            <Text style={styles.headerTitle}>Buscar Carona</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.inputsContainer}>
            <View style={styles.inputWrapper}>
              <Circle size={14} color="#00D159" fill="#00D159" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Centro"
                placeholderTextColor="#94A3B8"
                value={origin}
                onChangeText={setOrigin}
              />
            </View>

            <View style={styles.inputWrapper}>
              <MapPin size={16} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Campus Norte"
                placeholderTextColor="#94A3B8"
                value={destination}
                onChangeText={setDestination}
              />
            </View>

            <View style={styles.rowInputs}>
              <View style={[styles.inputWrapper, { flex: 1 }]}>
                <TextInput
                  style={styles.input}
                  placeholder="Hoje"
                  placeholderTextColor="#94A3B8"
                  value={dateFilter}
                  onChangeText={setDateFilter}
                />
              </View>
              <View style={[styles.inputWrapper, { flex: 1 }]}>
                <TextInput
                  style={styles.input}
                  placeholder="08:00"
                  placeholderTextColor="#94A3B8"
                  value={timeFilter}
                  onChangeText={setTimeFilter}
                />
              </View>
            </View>
          </View>
        </View>

        {/* ÁREA BRANCA DE RESULTADOS */}
        <View style={styles.contentWrapper}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsCount}>
                {loading ? 'Buscando...' : `${displayedRides.length} ${displayedRides.length === 1 ? 'carona encontrada' : 'caronas encontradas'}`}
              </Text>
              <Pressable style={styles.filterButton}>
                <SlidersHorizontal size={14} color={colors.primary} />
                <Text style={styles.filterButtonText}>Filtros</Text>
              </Pressable>
            </View>

            {loading ? (
              <View style={styles.stateContainer}>
                <ActivityIndicator color={colors.primary} size="large" />
              </View>
            ) : error ? (
              <View style={styles.stateContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : displayedRides.length === 0 ? (
              <View style={styles.stateContainer}>
                <Text style={styles.emptyText}>Nenhuma carona encontrada para estes locais.</Text>
              </View>
            ) : (
              <View style={styles.rideList}>
                {displayedRides.map((ride) => {
                  const { dayMonth, time } = formatDateTime(ride.departureAt);
                  const carModel = ride.vehicle ? `${ride.vehicle.brand} ${ride.vehicle.model}` : 'Veículo padrão';

                  return (
                    <View key={ride.id} style={styles.card}>
                      
                      {/* HEADER DO CARD */}
                      <View style={styles.cardHeader}>
                        <View style={styles.driverInfo}>
                          <View style={styles.avatar}>
                            <Text style={styles.avatarText}>{getInitials(ride.driver.fullName)}</Text>
                          </View>
                          <View>
                            <Text style={styles.driverName}>{ride.driver.fullName}</Text>
                            <View style={styles.ratingRow}>
                              <Star size={12} color="#00D159" fill="#00D159" />
                              <Text style={styles.ratingText}>4.8</Text>
                              <Text style={styles.carText}>{carModel}</Text>
                            </View>
                          </View>
                        </View>
                        <View style={styles.priceContainer}>
                          {/* Substitua "Solidária" pelo preço se houver essa lógica no futuro */}
                          <Text style={styles.priceValue}>Solidária</Text>
                          <Text style={styles.priceLabel}>por pessoa</Text>
                        </View>
                      </View>

                      {/* ROTA */}
                      <View style={styles.routeContainer}>
                        <View style={styles.routeTimeline}>
                          <View style={styles.dotOrigin} />
                          <View style={styles.line} />
                          <MapPin size={14} color={colors.primary} style={styles.pinDest} />
                        </View>
                        <View style={styles.routeDetails}>
                          <View style={styles.originBlock}>
                            <Text style={styles.locationName}>{ride.originLocation.name}</Text>
                            <Text style={styles.dateTimeText}>{dayMonth} • {time}</Text>
                          </View>
                          <View style={styles.destBlock}>
                            <Text style={styles.locationName}>{ride.destinationLocation.name}</Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.divider} />

                      {/* FOOTER DO CARD */}
                      <View style={styles.cardFooter}>
                        <Text style={styles.seatsText}>
                          {ride.availableSeats} {ride.availableSeats === 1 ? 'vaga disponível' : 'vagas disponíveis'}
                        </Text>
                        <Pressable style={styles.reserveButton}>
                          <Text style={styles.reserveButtonText}>Reservar</Text>
                        </Pressable>
                      </View>

                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
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