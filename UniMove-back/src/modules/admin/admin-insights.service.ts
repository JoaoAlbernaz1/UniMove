import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  AcademicVerificationStatus,
  IncidentStatus,
  ReservationStatus,
  RideRequestStatus,
  RideStatus,
  RoleName,
  UserStatus,
} from '../../generated/prisma/enums';
import type { ReportType } from './admin.dto';
import { toCsv } from './csv';

const TIME_ZONE = 'America/Sao_Paulo';
const EXPORT_LIMIT = 5000;

function since(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Sem base de cálculo não há percentual: o painel mostra "sem dados". */
function rate(part: number, whole: number) {
  return whole > 0 ? part / whole : null;
}

function countsBy<K extends string>(rows: { key: K; count: number }[]) {
  return Object.fromEntries(rows.map((row) => [row.key, row.count])) as Partial<Record<K, number>>;
}

function formatCents(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

@Injectable()
export class AdminInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const activeAccount = { deletedAt: null };
    const [
      totalUsers,
      activeUsers,
      drivers,
      rideRows,
      pendingVerifications,
      staleVerifications,
      openIncidents,
      underReviewIncidents,
    ] = await Promise.all([
      this.prisma.user.count({ where: activeAccount }),
      this.prisma.user.count({ where: { ...activeAccount, status: UserStatus.ACTIVE } }),
      this.prisma.user.count({
        where: { ...activeAccount, roles: { some: { role: { name: RoleName.DRIVER } } } },
      }),
      this.prisma.ride.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.academicVerification.count({
        where: { status: AcademicVerificationStatus.PENDING_REVIEW },
      }),
      this.prisma.academicVerification.count({
        where: {
          status: AcademicVerificationStatus.PENDING_REVIEW,
          submittedAt: { lt: since(1) },
        },
      }),
      this.prisma.incident.count({ where: { status: IncidentStatus.OPEN } }),
      this.prisma.incident.count({ where: { status: IncidentStatus.UNDER_REVIEW } }),
    ]);
    const rides = countsBy(rideRows.map((row) => ({ key: row.status, count: row._count._all })));
    return {
      users: { total: totalUsers, active: activeUsers, drivers },
      rides: {
        open: rides[RideStatus.OPEN] ?? 0,
        scheduled: rides[RideStatus.SCHEDULED] ?? 0,
        inProgress: rides[RideStatus.IN_PROGRESS] ?? 0,
        completed: rides[RideStatus.COMPLETED] ?? 0,
        cancelled: rides[RideStatus.CANCELLED] ?? 0,
      },
      verifications: { pending: pendingVerifications, pendingOver24h: staleVerifications },
      incidents: { open: openIncidents, underReview: underReviewIncidents },
      generatedAt: new Date(),
    };
  }

  /** Um ponto por dia, inclusive os dias sem movimento, no fuso do campus. */
  series(days: number) {
    return this.prisma.$queryRaw<{ date: string; users: number; rides: number }[]>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(
          (now() AT TIME ZONE ${TIME_ZONE})::date - (${days}::int - 1),
          (now() AT TIME ZONE ${TIME_ZONE})::date,
          interval '1 day'
        )::date AS day
      ),
      signups AS (
        SELECT (created_at AT TIME ZONE ${TIME_ZONE})::date AS day, count(*)::int AS total
        FROM users
        WHERE deleted_at IS NULL AND created_at >= now() - make_interval(days => ${days}::int + 1)
        GROUP BY 1
      ),
      published AS (
        SELECT (created_at AT TIME ZONE ${TIME_ZONE})::date AS day, count(*)::int AS total
        FROM rides
        WHERE created_at >= now() - make_interval(days => ${days}::int + 1)
        GROUP BY 1
      )
      SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
             COALESCE(signups.total, 0) AS users,
             COALESCE(published.total, 0) AS rides
      FROM days
      LEFT JOIN signups ON signups.day = days.day
      LEFT JOIN published ON published.day = days.day
      ORDER BY days.day
    `);
  }

  async report(days: number) {
    const start = since(days);
    const [rideRows, requestRows, verificationRows, incidentRows, originRows, estimate, series] =
      await Promise.all([
        this.prisma.ride.groupBy({
          by: ['status'],
          where: { departureAt: { gte: start, lte: new Date() } },
          _count: { _all: true },
        }),
        this.prisma.rideRequest.groupBy({
          by: ['status'],
          where: { createdAt: { gte: start } },
          _count: { _all: true },
        }),
        this.prisma.academicVerification.groupBy({
          by: ['status'],
          where: { submittedAt: { gte: start } },
          _count: { _all: true },
        }),
        this.prisma.incident.groupBy({
          by: ['type'],
          where: { createdAt: { gte: start } },
          _count: { _all: true },
        }),
        this.prisma.ride.groupBy({
          by: ['originLocationId'],
          where: { createdAt: { gte: start } },
          _count: { _all: true },
          orderBy: { _count: { originLocationId: 'desc' } },
          take: 5,
        }),
        this.prisma.$queryRaw<{ cents: number }[]>(Prisma.sql`
          SELECT COALESCE(SUM(r.price_per_person_cents * rr.seats), 0)::int AS cents
          FROM ride_reservations rr
          JOIN rides r ON r.id = rr.ride_id
          WHERE r.status = 'COMPLETED'
            AND rr.status = ${ReservationStatus.COMPLETED}::"ReservationStatus"
            AND r.departure_at >= ${start}
        `),
        this.series(days),
      ]);
    const rides = countsBy(rideRows.map((row) => ({ key: row.status, count: row._count._all })));
    const requests = countsBy(
      requestRows.map((row) => ({ key: row.status, count: row._count._all })),
    );
    const completed = rides[RideStatus.COMPLETED] ?? 0;
    const cancelled = rides[RideStatus.CANCELLED] ?? 0;
    const accepted = requests[RideRequestStatus.ACCEPTED] ?? 0;
    const answered =
      accepted +
      (requests[RideRequestStatus.REJECTED] ?? 0) +
      (requests[RideRequestStatus.EXPIRED] ?? 0);
    const locations = await this.prisma.location.findMany({
      where: { id: { in: originRows.map((row) => row.originLocationId) } },
      select: { id: true, name: true },
    });
    const locationName = new Map(locations.map((item) => [item.id, item.name]));
    return {
      days,
      completionRate: rate(completed, completed + cancelled),
      cancellationRate: rate(cancelled, completed + cancelled),
      requestAcceptanceRate: rate(accepted, answered),
      // Soma de valores anunciados. O sistema não confirma pagamento algum.
      estimatedValueCents: estimate[0]?.cents ?? 0,
      topOrigins: originRows.map((row) => ({
        name: locationName.get(row.originLocationId) ?? 'Local removido',
        rides: row._count._all,
      })),
      verifications: countsBy(
        verificationRows.map((row) => ({ key: row.status, count: row._count._all })),
      ),
      incidentsByType: countsBy(
        incidentRows.map((row) => ({ key: row.type, count: row._count._all })),
      ),
      series,
    };
  }

  /**
   * CSV com colunas fechadas. CPF, e-mail, telefone, matrícula, GUID, placa e textos
   * livres (motivos e relatos) ficam de fora por decisão, não por acaso: a planilha
   * sai do alcance dos controles do sistema.
   */
  async exportReport(actorId: string, type: ReportType, days: number) {
    const start = since(days);
    const { headers, rows } = await this.reportRows(type, start);
    const truncated = rows.length > EXPORT_LIMIT;
    const kept = truncated ? rows.slice(0, EXPORT_LIMIT) : rows;
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actorId,
        action: 'ADMIN_REPORT_EXPORTED',
        entityType: 'Report',
        entityId: type,
        metadata: { days, rows: kept.length, truncated },
      },
    });
    return {
      csv: toCsv(headers, kept),
      filename: `unicarona-${type}-${days}-dias.csv`,
      truncated,
    };
  }

  private async reportRows(type: ReportType, start: Date) {
    const take = EXPORT_LIMIT + 1;
    switch (type) {
      case 'users': {
        const users = await this.prisma.user.findMany({
          where: { createdAt: { gte: start }, deletedAt: null },
          select: {
            id: true,
            fullName: true,
            course: true,
            status: true,
            createdAt: true,
            roles: { select: { role: { select: { name: true } } } },
            academicVerification: { select: { status: true } },
          },
          orderBy: { createdAt: 'desc' },
          take,
        });
        return {
          headers: ['id', 'nome', 'curso', 'perfis', 'verificacao', 'situacao', 'cadastro'],
          rows: users.map((user) => [
            user.id,
            user.fullName,
            user.course,
            user.roles.map((item) => item.role.name).join(', '),
            user.academicVerification?.status ?? 'NAO_ENVIADA',
            user.status,
            user.createdAt.toISOString(),
          ]),
        };
      }
      case 'rides': {
        const rides = await this.prisma.ride.findMany({
          where: { departureAt: { gte: start } },
          select: {
            id: true,
            status: true,
            departureAt: true,
            totalSeats: true,
            availableSeats: true,
            pricePerPersonCents: true,
            driver: { select: { fullName: true } },
            originLocation: { select: { name: true } },
            destinationLocation: { select: { name: true } },
          },
          orderBy: { departureAt: 'desc' },
          take,
        });
        return {
          headers: [
            'id',
            'motorista',
            'origem',
            'destino',
            'saida',
            'vagas_totais',
            'vagas_livres',
            'valor_anunciado_por_pessoa_nao_e_pagamento',
            'situacao',
          ],
          rows: rides.map((ride) => [
            ride.id,
            ride.driver.fullName,
            ride.originLocation.name,
            ride.destinationLocation.name,
            ride.departureAt.toISOString(),
            ride.totalSeats,
            ride.availableSeats,
            formatCents(ride.pricePerPersonCents),
            ride.status,
          ]),
        };
      }
      case 'verifications': {
        const verifications = await this.prisma.academicVerification.findMany({
          where: { submittedAt: { gte: start } },
          select: {
            userId: true,
            status: true,
            submittedAt: true,
            reviewedAt: true,
            user: { select: { fullName: true, course: true } },
            reviewedBy: { select: { fullName: true } },
          },
          orderBy: { submittedAt: 'desc' },
          take,
        });
        return {
          headers: ['usuario_id', 'nome', 'curso', 'situacao', 'envio', 'decisao', 'revisor'],
          rows: verifications.map((item) => [
            item.userId,
            item.user.fullName,
            item.user.course,
            item.status,
            item.submittedAt.toISOString(),
            item.reviewedAt?.toISOString(),
            item.reviewedBy?.fullName,
          ]),
        };
      }
      case 'incidents': {
        const incidents = await this.prisma.incident.findMany({
          where: { createdAt: { gte: start } },
          select: {
            id: true,
            rideId: true,
            type: true,
            status: true,
            createdAt: true,
            resolvedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take,
        });
        return {
          headers: ['id', 'carona_id', 'tipo', 'situacao', 'registro', 'conclusao'],
          rows: incidents.map((item) => [
            item.id,
            item.rideId,
            item.type,
            item.status,
            item.createdAt.toISOString(),
            item.resolvedAt?.toISOString(),
          ]),
        };
      }
    }
  }
}
