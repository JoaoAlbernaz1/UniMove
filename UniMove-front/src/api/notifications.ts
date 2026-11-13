import type { NotificationCategory, NotificationPage } from '../notifications';

type AuthApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export const NOTIFICATIONS_PAGE_SIZE = 20;

export function listNotifications(
  authApi: AuthApi,
  { page, category }: { page: number; category: NotificationCategory },
) {
  const params = new URLSearchParams({ page: String(page), limit: String(NOTIFICATIONS_PAGE_SIZE) });
  if (category !== 'all') params.set('category', category);
  return authApi<NotificationPage>(`/notifications?${params.toString()}`);
}

export async function getUnreadNotificationCount(authApi: AuthApi) {
  const { count } = await authApi<{ count: number }>('/notifications/unread-count');
  return count;
}

export function markNotificationRead(authApi: AuthApi, id: string) {
  return authApi<null>(`/notifications/${id}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead(authApi: AuthApi) {
  return authApi<{ updated: number }>('/notifications/read-all', { method: 'PATCH' });
}

export function deleteNotification(authApi: AuthApi, id: string) {
  return authApi<null>(`/notifications/${id}`, { method: 'DELETE' });
}
