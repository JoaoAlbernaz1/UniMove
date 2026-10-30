import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { AchievementsService, type AchievementMetrics } from './achievements.service';

describe('Conquistas calculadas no backend', () => {
  const query = jest.fn();
  const service = new AchievementsService({ $queryRaw: query } as unknown as PrismaService);
  const empty: AchievementMetrics = {
    profileComplete: false,
    driverTrips: 0,
    passengerTrips: 0,
    totalTrips: 0,
    connections: 0,
    ratingCount: 0,
    ratingAverage: null,
  };
  const load = (change: Partial<AchievementMetrics>) => {
    query.mockResolvedValue([{ ...empty, ...change }]);
    return service.list('user-id');
  };
  beforeEach(() => jest.clearAllMocks());

  it('não concede conquistas fictícias quando não há histórico', async () => {
    const result = await load({});
    expect(result.total).toBe(8);
    expect(result.unlockedCount).toBe(0);
    expect(result.items.every((item) => !item.unlocked)).toBe(true);
    expect(result.items.find((item) => item.id === 'good-company')?.progress.label).toContain(
      'sem avaliações',
    );
  });

  it('concede somente Perfil completo após o preenchimento obrigatório', async () => {
    const result = await load({ profileComplete: true });
    expect(result.items.filter((item) => item.unlocked).map((item) => item.id)).toEqual([
      'complete-profile',
    ]);
  });

  it.each([
    ['first-offered-ride', 'driverTrips', 1],
    ['first-received-ride', 'passengerTrips', 1],
    ['partner-driver', 'driverTrips', 10],
    ['frequent-passenger', 'passengerTrips', 10],
    ['campus-connections', 'connections', 5],
    ['community-in-motion', 'totalTrips', 50],
  ] as const)('respeita o limite exato de %s', async (id, metric, target) => {
    const before = await load({ [metric]: target - 1 });
    expect(before.items.find((item) => item.id === id)?.unlocked).toBe(false);
    const after = await load({ [metric]: target });
    expect(after.items.find((item) => item.id === id)?.unlocked).toBe(true);
    expect(after.items.find((item) => item.id === id)?.progress.percentage).toBe(100);
  });

  it.each([
    [9, 5, false],
    [10, 4.7999, false],
    [10, 4.8, true],
    [20, 4.9, true],
    [20, null, false],
  ] as const)(
    'Boa companhia com %s avaliações e média %s: %s',
    async (ratingCount, ratingAverage, unlocked) => {
      const result = await load({ ratingCount, ratingAverage });
      expect(result.items.find((item) => item.id === 'good-company')?.unlocked).toBe(unlocked);
    },
  );

  it('recalcula os critérios atuais sem gravar concessões ou alterar os dados', async () => {
    expect(
      (await load({ driverTrips: 100 })).items.find((item) => item.id === 'partner-driver')
        ?.progress.percentage,
    ).toBe(100);
    query.mockResolvedValue([]);
    await expect(service.list('missing-user')).rejects.toBeInstanceOf(NotFoundException);
  });
});
