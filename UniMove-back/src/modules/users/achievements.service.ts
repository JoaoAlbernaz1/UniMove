import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export type AchievementMetrics = {
  profileComplete: boolean;
  driverTrips: number;
  passengerTrips: number;
  totalTrips: number;
  connections: number;
  ratingCount: number;
  ratingAverage: number | null;
};

const catalog = [
  {
    id: 'complete-profile',
    title: 'Perfil completo',
    description: 'Preencha curso, período, Sobre e pelo menos 3 tags diferentes.',
    icon: 'profile',
    metric: 'profileComplete',
    target: 1,
    unit: 'perfil completo',
  },
  {
    id: 'first-offered-ride',
    title: 'Primeira carona oferecida',
    description: 'Conclua sua primeira viagem como motorista, com passageiro.',
    icon: 'car',
    metric: 'driverTrips',
    target: 1,
    unit: 'viagem como motorista',
  },
  {
    id: 'first-received-ride',
    title: 'Primeira carona recebida',
    description: 'Conclua sua primeira viagem como passageiro.',
    icon: 'passenger',
    metric: 'passengerTrips',
    target: 1,
    unit: 'viagem como passageiro',
  },
  {
    id: 'partner-driver',
    title: 'Motorista parceiro',
    description: 'Conclua 10 viagens como motorista, com passageiros.',
    icon: 'car',
    metric: 'driverTrips',
    target: 10,
    unit: 'viagens como motorista',
  },
  {
    id: 'frequent-passenger',
    title: 'Passageiro frequente',
    description: 'Conclua 10 viagens como passageiro.',
    icon: 'passenger',
    metric: 'passengerTrips',
    target: 10,
    unit: 'viagens como passageiro',
  },
  {
    id: 'campus-connections',
    title: 'Conexões do campus',
    description: 'Conclua viagens com 5 pessoas diferentes.',
    icon: 'users',
    metric: 'connections',
    target: 5,
    unit: 'pessoas diferentes',
  },
  {
    id: 'community-in-motion',
    title: 'Comunidade em movimento',
    description: 'Participe de 50 viagens concluídas, como motorista ou passageiro.',
    icon: 'trophy',
    metric: 'totalTrips',
    target: 50,
    unit: 'viagens concluídas',
  },
  {
    id: 'good-company',
    title: 'Boa companhia',
    description:
      'Receba pelo menos 10 avaliações de viagens concluídas e mantenha média de 4,8 ou mais.',
    icon: 'star',
    metric: 'ratingCount',
    target: 10,
    unit: 'avaliações',
  },
] as const;

@Injectable()
export class AchievementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    // Uma viagem conta uma vez, independentemente de vagas, reservas repetidas
    // ou do número de passageiros. Os participantes são deduplicados no banco.
    const [metrics] = await this.prisma.$queryRaw<AchievementMetrics[]>(Prisma.sql`
      WITH trips AS (
        SELECT r.id, r.driver_id
        FROM rides r
        WHERE r.status = 'COMPLETED'
          AND EXISTS (
            SELECT 1 FROM ride_reservations occupied
            WHERE occupied.ride_id = r.id AND occupied.passenger_id <> r.driver_id
              AND occupied.status IN ('CONFIRMED', 'COMPLETED')
          )
          AND (r.driver_id = ${userId}::uuid OR EXISTS (
            SELECT 1 FROM ride_reservations mine
            WHERE mine.ride_id = r.id AND mine.passenger_id = ${userId}::uuid
              AND mine.status IN ('CONFIRMED', 'COMPLETED')
          ))
      ), participants AS (
        SELECT id AS ride_id, driver_id AS user_id FROM trips
        UNION
        SELECT t.id, p.passenger_id FROM trips t
        JOIN ride_reservations p ON p.ride_id = t.id
        WHERE p.status IN ('CONFIRMED', 'COMPLETED')
      ), received_ratings AS (
        SELECT rating.score FROM ratings rating
        JOIN trips t ON t.id = rating.ride_id
        WHERE rating.reviewed_user_id = ${userId}::uuid
          AND rating.reviewer_id <> rating.reviewed_user_id
          AND rating.score BETWEEN 1 AND 5
          AND EXISTS (SELECT 1 FROM participants p WHERE p.ride_id = rating.ride_id AND p.user_id = rating.reviewer_id)
      )
      SELECT (u.profile_completed_at IS NOT NULL) AS "profileComplete",
        (SELECT count(*)::int FROM trips WHERE driver_id = u.id) AS "driverTrips",
        (SELECT count(*)::int FROM trips WHERE driver_id <> u.id) AS "passengerTrips",
        (SELECT count(*)::int FROM trips) AS "totalTrips",
        (SELECT count(DISTINCT user_id)::int FROM participants WHERE user_id <> u.id) AS "connections",
        (SELECT count(*)::int FROM received_ratings) AS "ratingCount",
        (SELECT avg(score)::double precision FROM received_ratings) AS "ratingAverage"
      FROM users u WHERE u.id = ${userId}::uuid
    `);
    if (!metrics) throw new NotFoundException('Usuário não encontrado.');

    const items = catalog.map((definition) => {
      const current =
        definition.metric === 'profileComplete'
          ? Number(metrics.profileComplete)
          : metrics[definition.metric];
      const rating = definition.id === 'good-company';
      const unlocked =
        current >= definition.target &&
        (!rating || (metrics.ratingAverage !== null && metrics.ratingAverage >= 4.8));
      const averageLabel =
        metrics.ratingAverage === null
          ? 'sem avaliações'
          : `média ${(Math.floor(metrics.ratingAverage * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
      return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        icon: definition.icon,
        unlocked,
        progress: {
          current,
          target: definition.target,
          percentage: rating
            ? null
            : Math.min(100, Math.floor((current / definition.target) * 100)),
          label: `${Math.min(current, definition.target)}/${definition.target} ${definition.unit}${rating ? ` · ${averageLabel}` : ''}`,
        },
      };
    });
    return {
      items,
      total: items.length,
      unlockedCount: items.filter((item) => item.unlocked).length,
    };
  }
}
