// Histórico é uma lista só: a mesma pessoa aparece como motorista nas caronas
// que ofereceu e como passageiro nas que pegou. O papel de cada linha sai da
// comparação entre o motorista da carona e o usuário logado.

export type HistoryRole = 'offered' | 'received';

type RawReservation = {
  passengerId: string;
  seats: number;
  status: string;
};

type RawRide = {
  id: string;
  departureAt: string;
  status: string;
  pricePerPersonCents: number;
  driverId: string;
  driver: { id: string; fullName: string };
  originLocation: { name: string };
  destinationLocation: { name: string };
  reservations: RawReservation[];
  ratings: { score: number; reviewerId: string; reviewedUserId: string }[];
};

export type HistoryItem = {
  id: string;
  role: HistoryRole;
  personName: string;
  initial: string;
  from: string;
  to: string;
  departureAt: string;
  passengers: number;
  amountCents: number;
  rating: number | null;
  status: string;
};

const PAID = ['CONFIRMED', 'COMPLETED'];

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Agendada',
  OPEN: 'Aberta',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};

function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function toHistoryItem(ride: RawRide, currentUserId: string): HistoryItem {
  const isDriver = ride.driverId === currentUserId;
  const paidReservations = ride.reservations.filter((r) => PAID.includes(r.status));
  const seatsSold = paidReservations.reduce((total, r) => total + r.seats, 0);
  const mySeats = paidReservations
    .filter((r) => r.passengerId === currentUserId)
    .reduce((total, r) => total + r.seats, 0);

  return {
    id: ride.id,
    role: isDriver ? 'offered' : 'received',
    personName: isDriver ? 'Você' : ride.driver.fullName,
    initial: isDriver ? 'V' : initialOf(ride.driver.fullName),
    from: ride.originLocation.name,
    to: ride.destinationLocation.name,
    departureAt: ride.departureAt,
    passengers: seatsSold,
    // Quem dirige recebe por todos os assentos vendidos; quem pega paga pelos seus.
    amountCents: isDriver
      ? ride.pricePerPersonCents * seatsSold
      : -(ride.pricePerPersonCents * mySeats),
    // A estrela é a nota de quem aparece no card: a sua quando você dirigiu,
    // a do motorista quando você foi passageiro.
    rating:
      (isDriver
        ? ride.ratings.find((r) => r.reviewedUserId === currentUserId)
        : ride.ratings.find((r) => r.reviewedUserId === ride.driverId)
      )?.score ?? null,
    status: STATUS_LABELS[ride.status] ?? ride.status,
  };
}

export type HistorySummary = {
  totalRides: number;
  earningsCents: number;
  spendingCents: number;
};

export type HistoryApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function fetchHistory(authApi: HistoryApi, page: number, limit: number) {
  const [me, rides] = await Promise.all([
    authApi<{ id: string }>('/users/me'),
    authApi<RawRide[]>(`/history?page=${page}&limit=${limit}`),
  ]);
  return rides.map((ride) => toHistoryItem(ride, me.id));
}

export function fetchHistorySummary(authApi: HistoryApi) {
  return authApi<HistorySummary>('/history/summary');
}

export function formatCurrency(cents: number) {
  const value = Math.abs(cents) / 100;
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

export function formatSigned(cents: number) {
  if (cents === 0) return 'Solidária';
  return `${cents > 0 ? '+' : '-'}${formatCurrency(cents)}`;
}

// "30 out" — dia e mês abreviado, como nos cartões do protótipo.
export function formatShortDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date
    .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    .replace('.', '');
}
