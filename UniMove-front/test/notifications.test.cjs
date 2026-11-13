const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatBadgeCount,
  formatRelativeTime,
  groupNotifications,
  groupedCountLabel,
  notificationAppearance,
  notificationTarget,
  rideSummary,
} = require('../src/notifications.ts');

// Datas locais, para o teste valer em qualquer fuso do computador.
const now = new Date(2026, 10, 13, 15, 0, 0);
const at = (...parts) => new Date(...parts).toISOString();
const item = (id, createdAt, extra = {}) => ({
  id,
  type: 'RIDE_COMPLETED',
  title: 'Carona concluída',
  message: 'Você chegou!',
  resourceType: 'RIDE',
  resourceId: 'ride-id',
  metadata: null,
  readAt: null,
  createdAt,
  ...extra,
});

test('mostra o tempo relativo como nos apps de referência', () => {
  assert.equal(formatRelativeTime(at(2026, 10, 13, 14, 59, 30), now), 'agora');
  assert.equal(formatRelativeTime(at(2026, 10, 13, 14, 55), now), 'há 5 min');
  assert.equal(formatRelativeTime(at(2026, 10, 13, 12, 0), now), 'há 3 h');
  assert.equal(formatRelativeTime(at(2026, 10, 12, 23, 0), now), 'ontem');
  assert.equal(formatRelativeTime(at(2026, 10, 9, 10, 0), now), 'seg.');
  assert.equal(formatRelativeTime(at(2026, 9, 2, 10, 0), now), '02/10');
  assert.equal(formatRelativeTime(at(2025, 9, 2, 10, 0), now), '02/10/2025');
});

test('agrupa a lista em Hoje, Ontem, Esta semana e Anteriores', () => {
  const sections = groupNotifications(
    [
      item('a', at(2026, 10, 13, 9, 0)),
      item('b', at(2026, 10, 13, 8, 0)),
      item('c', at(2026, 10, 12, 20, 0)),
      item('d', at(2026, 10, 10, 20, 0)),
      item('e', at(2026, 9, 1, 20, 0)),
    ],
    now,
  );
  assert.deepEqual(
    sections.map((section) => [section.title, section.data.map(({ id }) => id)]),
    [
      ['Hoje', ['a', 'b']],
      ['Ontem', ['c']],
      ['Esta semana', ['d']],
      ['Anteriores', ['e']],
    ],
  );
});

test('resume trajeto e horário da carona no fuso do dispositivo', () => {
  assert.deepEqual(
    rideSummary({
      ride: {
        origin: 'Taguatinga',
        destination: 'UCB Taguatinga',
        departureAt: at(2026, 11, 1, 7, 30),
      },
    }),
    { route: 'Taguatinga → UCB Taguatinga', when: '01/12, 07:30' },
  );
  assert.equal(rideSummary(null), null);
  assert.equal(rideSummary({ rideId: 'sem-contexto' }), null);
});

test('leva cada notificação para a tela correspondente', () => {
  assert.deepEqual(
    notificationTarget({ type: 'MESSAGE_RECEIVED', resourceType: 'CONVERSATION', resourceId: 'c1', metadata: null }),
    { screen: 'Chat', conversationId: 'c1' },
  );
  assert.deepEqual(notificationTarget({ type: 'RIDE_REQUEST_RECEIVED', metadata: null }), { screen: 'DriverRequests' });
  assert.deepEqual(notificationTarget({ type: 'RIDE_REQUEST_ACCEPTED', metadata: null }), { screen: 'PassengerRequests' });
  assert.deepEqual(notificationTarget({ type: 'RIDE_REQUEST_EXPIRED', metadata: null }), { screen: 'SearchRide' });
  assert.deepEqual(notificationTarget({ type: 'RIDE_COMPLETED', metadata: null }), { screen: 'History' });
  assert.deepEqual(notificationTarget({ type: 'ACCOUNT_UPDATED', resourceType: 'VEHICLE', metadata: null }), { screen: 'Profile' });
  assert.deepEqual(
    notificationTarget({ type: 'ACCOUNT_UPDATED', resourceType: 'ACADEMIC_VERIFICATION', metadata: null }),
    { screen: 'PersonalInfo' },
  );
  // Promoções apenas abrem o texto completo na própria central.
  assert.equal(notificationTarget({ type: 'PROMOTION', metadata: null }), null);
});

test('usa tons distintos para aprovação e recusa da validação', () => {
  assert.equal(
    notificationAppearance({ type: 'ACCOUNT_UPDATED', metadata: { kind: 'VERIFICATION_REJECTED' } }).tone,
    'danger',
  );
  assert.equal(
    notificationAppearance({ type: 'ACCOUNT_UPDATED', metadata: { kind: 'VERIFICATION_APPROVED' } }).tone,
    'success',
  );
  assert.deepEqual(notificationAppearance({ type: 'PROMOTION', metadata: null }), { icon: 'sparkles', tone: 'promo' });
});

test('limita o contador do sino e descreve mensagens agrupadas', () => {
  assert.equal(formatBadgeCount(0), null);
  assert.equal(formatBadgeCount(3), '3');
  assert.equal(formatBadgeCount(12), '9+');
  assert.equal(groupedCountLabel({ type: 'MESSAGE_RECEIVED', metadata: { count: 3 } }), '3 novas mensagens');
  assert.equal(groupedCountLabel({ type: 'MESSAGE_RECEIVED', metadata: { count: 1 } }), null);
  assert.equal(groupedCountLabel({ type: 'RIDE_STARTED', metadata: { count: 3 } }), null);
});
