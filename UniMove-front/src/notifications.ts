// Regras de apresentação da central de notificações. Sem dependências de React
// Native para poderem ser testadas com `node --test`.

export type NotificationType =
  | 'RIDE_REQUEST_RECEIVED'
  | 'RIDE_REQUEST_SENT'
  | 'RIDE_REQUEST_ACCEPTED'
  | 'RIDE_REQUEST_REJECTED'
  | 'RIDE_REQUEST_EXPIRED'
  | 'RIDE_CANCELLED'
  | 'RIDE_STARTED'
  | 'RIDE_COMPLETED'
  | 'RIDE_PUBLISHED'
  | 'MESSAGE_RECEIVED'
  | 'INCIDENT_UPDATED'
  | 'ACCOUNT_UPDATED'
  | 'SYSTEM'
  | 'PROMOTION';

export type NotificationRide = {
  origin: string;
  destination: string;
  departureAt: string;
  driverName?: string;
};

export type NotificationMetadata = {
  rideId?: string;
  ride?: NotificationRide;
  count?: number;
  kind?: string;
  senderName?: string;
  [key: string]: unknown;
};

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: NotificationMetadata | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPage = {
  items: AppNotification[];
  page: number;
  limit: number;
  total: number;
};

export type NotificationCategory = 'all' | 'rides' | 'messages' | 'account' | 'promotions';

export const NOTIFICATION_TABS: { id: NotificationCategory; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'rides', label: 'Caronas' },
  { id: 'messages', label: 'Mensagens' },
  { id: 'account', label: 'Conta' },
  { id: 'promotions', label: 'Novidades' },
];

/** Aparência de cada tipo: ícone (nome em `NotificationsScreen`) e tom de cor. */
export type NotificationTone = 'success' | 'info' | 'warning' | 'danger' | 'promo';
export type NotificationIcon =
  | 'car'
  | 'send'
  | 'check'
  | 'x'
  | 'clock'
  | 'flag'
  | 'message'
  | 'shield'
  | 'user'
  | 'sparkles'
  | 'bell';

export function notificationAppearance(
  notification: Pick<AppNotification, 'type' | 'metadata'>,
): { icon: NotificationIcon; tone: NotificationTone } {
  switch (notification.type) {
    case 'RIDE_REQUEST_RECEIVED':
      return { icon: 'user', tone: 'info' };
    case 'RIDE_REQUEST_SENT':
      return { icon: 'send', tone: 'info' };
    case 'RIDE_REQUEST_ACCEPTED':
      return { icon: 'check', tone: 'success' };
    case 'RIDE_REQUEST_REJECTED':
      return { icon: 'x', tone: 'danger' };
    case 'RIDE_REQUEST_EXPIRED':
      return { icon: 'clock', tone: 'warning' };
    case 'RIDE_CANCELLED':
      return { icon: 'x', tone: 'danger' };
    case 'RIDE_STARTED':
      return { icon: 'car', tone: 'success' };
    case 'RIDE_COMPLETED':
      return { icon: 'flag', tone: 'success' };
    case 'RIDE_PUBLISHED':
      return { icon: 'car', tone: 'info' };
    case 'MESSAGE_RECEIVED':
      return { icon: 'message', tone: 'info' };
    case 'INCIDENT_UPDATED':
      return { icon: 'shield', tone: 'warning' };
    case 'ACCOUNT_UPDATED':
      return notification.metadata?.kind === 'VERIFICATION_REJECTED'
        ? { icon: 'shield', tone: 'danger' }
        : notification.metadata?.kind === 'VEHICLE_REGISTERED'
          ? { icon: 'car', tone: 'success' }
          : { icon: 'shield', tone: 'success' };
    case 'PROMOTION':
      return { icon: 'sparkles', tone: 'promo' };
    default:
      return { icon: 'bell', tone: 'info' };
  }
}

/** Para onde o toque na notificação leva o usuário. */
export type NotificationTarget =
  | { screen: 'Chat'; conversationId: string }
  | { screen: 'DriverRequests' }
  | { screen: 'PassengerRequests' }
  | { screen: 'History' }
  | { screen: 'SearchRide' }
  | { screen: 'PersonalInfo' }
  | { screen: 'Profile' }
  | { screen: 'Home' }
  | null;

export function notificationTarget(
  notification: Pick<AppNotification, 'type' | 'resourceType' | 'resourceId' | 'metadata'>,
): NotificationTarget {
  switch (notification.type) {
    case 'MESSAGE_RECEIVED':
      return notification.resourceId
        ? { screen: 'Chat', conversationId: notification.resourceId }
        : null;
    case 'RIDE_REQUEST_RECEIVED':
      return { screen: 'DriverRequests' };
    case 'RIDE_REQUEST_SENT':
    case 'RIDE_REQUEST_ACCEPTED':
      return { screen: 'PassengerRequests' };
    case 'RIDE_REQUEST_REJECTED':
    case 'RIDE_REQUEST_EXPIRED':
      return { screen: 'SearchRide' };
    case 'RIDE_CANCELLED':
    case 'RIDE_STARTED':
    case 'RIDE_COMPLETED':
      return { screen: 'History' };
    case 'RIDE_PUBLISHED':
      return { screen: 'Home' };
    case 'ACCOUNT_UPDATED':
      return notification.resourceType === 'VEHICLE'
        ? { screen: 'Profile' }
        : { screen: 'PersonalInfo' };
    case 'SYSTEM':
      return notification.metadata?.kind === 'WELCOME' ? { screen: 'PersonalInfo' } : null;
    default:
      return null;
  }
}

const pad = (value: number) => String(value).padStart(2, '0');

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

/** "agora", "há 5 min", "há 3 h", "ontem", "seg.", "12/11", como nos apps de referência. */
export function formatRelativeTime(iso: string, now = new Date()) {
  const date = new Date(iso);
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return 'agora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const days = daysBetween(date, now);
  if (days === 0) return `há ${Math.floor(minutes / 60)} h`;
  if (days === 1) return 'ontem';
  if (days < 7) return ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'][date.getDay()];
  const sameYear = date.getFullYear() === now.getFullYear();
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}${sameYear ? '' : `/${date.getFullYear()}`}`;
}

/** Trajeto e horário da carona relacionada, no fuso do dispositivo. */
export function rideSummary(metadata: NotificationMetadata | null | undefined) {
  const ride = metadata?.ride;
  if (!ride?.origin || !ride.destination) return null;
  const departure = new Date(ride.departureAt);
  const when = Number.isFinite(departure.getTime())
    ? `${pad(departure.getDate())}/${pad(departure.getMonth() + 1)}, ${pad(departure.getHours())}:${pad(departure.getMinutes())}`
    : null;
  return { route: `${ride.origin} → ${ride.destination}`, when };
}

export type NotificationSection = { title: string; data: AppNotification[] };

/** Agrupa a lista já ordenada (mais recente primeiro) em seções por período. */
export function groupNotifications(items: AppNotification[], now = new Date()) {
  const sections: NotificationSection[] = [];
  for (const item of items) {
    const days = daysBetween(new Date(item.createdAt), now);
    const title = days <= 0 ? 'Hoje' : days === 1 ? 'Ontem' : days < 7 ? 'Esta semana' : 'Anteriores';
    const last = sections[sections.length - 1];
    if (last?.title === title) last.data.push(item);
    else sections.push({ title, data: [item] });
  }
  return sections;
}

/** Texto do contador do sino: até 9 e depois "9+". */
export function formatBadgeCount(count: number) {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/** Quantidade agrupada de mensagens não lidas da mesma conversa. */
export function groupedCountLabel(notification: Pick<AppNotification, 'type' | 'metadata'>) {
  const count = notification.metadata?.count;
  if (notification.type !== 'MESSAGE_RECEIVED' || typeof count !== 'number' || count < 2)
    return null;
  return `${count} novas mensagens`;
}
