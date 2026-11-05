import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { IncidentStatus, NotificationType } from '../../generated/prisma/enums';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { NotificationService } from '../notifications/notifications.service';
import { AUTH_STATE_ENTITY_TYPES } from '../auth/auth-attempt-limiter';
import { heldSeats, heldSeatsByRide, seatsOnOffer } from '../rides/ride-availability';
import {
  AdminAuditQueryDto,
  AdminIncidentsQueryDto,
  AdminRidesQueryDto,
  UpdateIncidentDto,
} from './admin.dto';
import { maskPlate } from './admin-users.service';

const person = { select: { id: true, fullName: true } } as const;
const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  [IncidentStatus.OPEN]: [
    IncidentStatus.UNDER_REVIEW,
    IncidentStatus.RESOLVED,
    IncidentStatus.DISMISSED,
  ],
  [IncidentStatus.UNDER_REVIEW]: [IncidentStatus.RESOLVED, IncidentStatus.DISMISSED],
  [IncidentStatus.RESOLVED]: [],
  [IncidentStatus.DISMISSED]: [],
};
const FINAL_INCIDENT_STATUSES: IncidentStatus[] = [
  IncidentStatus.RESOLVED,
  IncidentStatus.DISMISSED,
];

/** Consulta de caronas, denúncias e auditoria. Mensagens privadas não passam por aqui. */
@Injectable()
export class AdminOperationsService {
  private readonly logger = new Logger(AdminOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async rides(query: AdminRidesQueryDto) {
    const where: Prisma.RideWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            departureAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { driver: { fullName: { contains: query.q, mode: 'insensitive' } } },
              { originLocation: { name: { contains: query.q, mode: 'insensitive' } } },
              { destinationLocation: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total, byStatus] = await Promise.all([
      this.prisma.ride.findMany({
        where,
        select: {
          id: true,
          status: true,
          departureAt: true,
          totalSeats: true,
          availableSeats: true,
          pricePerPersonCents: true,
          driver: person,
          originLocation: { select: { name: true } },
          destinationLocation: { select: { name: true } },
        },
        orderBy: { departureAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.ride.count({ where }),
      this.prisma.ride.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    // O painel anuncia a mesma vaga que o estudante vê: solicitação pendente
    // segura o assento até expirar, e o app já desconta isso.
    const retidos = await heldSeatsByRide(
      this.prisma,
      items.map((ride) => ride.id),
      new Date(),
    );
    return {
      items: items.map((ride) => ({
        ...ride,
        availableSeats: seatsOnOffer(ride.availableSeats, retidos.get(ride.id)),
      })),
      total,
      statusCounts: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    };
  }

  async ride(id: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        departureAt: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        cancelledAt: true,
        totalSeats: true,
        availableSeats: true,
        pricePerPersonCents: true,
        additionalInfo: true,
        driver: person,
        vehicle: { select: { brand: true, model: true, color: true, plate: true } },
        originLocation: { select: { name: true } },
        destinationLocation: { select: { name: true } },
        requests: {
          select: {
            id: true,
            status: true,
            seatsRequested: true,
            createdAt: true,
            passenger: person,
          },
          orderBy: { createdAt: 'desc' },
        },
        reservations: {
          select: { id: true, status: true, seats: true, confirmedAt: true, passenger: person },
          orderBy: { confirmedAt: 'desc' },
        },
        cancellations: {
          select: { id: true, reason: true, createdAt: true, cancelledBy: person },
          orderBy: { createdAt: 'desc' },
        },
        incidents: {
          select: { id: true, type: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!ride) throw new NotFoundException('Carona não encontrada.');
    return {
      ...ride,
      availableSeats: seatsOnOffer(ride.availableSeats, await heldSeats(this.prisma, ride.id, new Date())),
      vehicle: { ...ride.vehicle, plate: maskPlate(ride.vehicle.plate) },
    };
  }

  async incidents(query: AdminIncidentsQueryDto) {
    const where: Prisma.IncidentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [items, total, byStatus] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        select: {
          id: true,
          rideId: true,
          type: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
          reportedBy: person,
          reportedUser: person,
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.incident.count({ where }),
      this.prisma.incident.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      items,
      total,
      statusCounts: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    };
  }

  async incident(id: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        description: true,
        createdAt: true,
        resolvedAt: true,
        reportedBy: person,
        reportedUser: person,
        ride: {
          select: {
            id: true,
            status: true,
            departureAt: true,
            driver: person,
            originLocation: { select: { name: true } },
            destinationLocation: { select: { name: true } },
          },
        },
      },
    });
    if (!incident) throw new NotFoundException('Denúncia não encontrada.');
    const decisions = await this.prisma.auditLog.findMany({
      where: { entityType: 'Incident', entityId: id },
      select: {
        id: true,
        action: true,
        metadata: true,
        createdAt: true,
        actor: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { ...incident, decisions };
  }

  async updateIncident(actor: AuthUser, id: string, dto: UpdateIncidentDto) {
    if (FINAL_INCIDENT_STATUSES.includes(dto.status) && !dto.note)
      throw new BadRequestException('Registre a justificativa da decisão.');

    const incident = await this.prisma.$transaction(async (tx) => {
      const current = await tx.incident.findUnique({
        where: { id },
        select: { status: true, reportedById: true },
      });
      if (!current) throw new NotFoundException('Denúncia não encontrada.');
      if (!INCIDENT_TRANSITIONS[current.status].includes(dto.status))
        throw new ConflictException({
          code: 'INCIDENT_TRANSITION_INVALID',
          message:
            'A situação desta denúncia mudou ou não permite esta decisão. Atualize a página.',
        });
      // Condicional no status lido: se outro admin decidiu antes, não sobrescreve.
      const { count } = await tx.incident.updateMany({
        where: { id, status: current.status },
        data: {
          status: dto.status,
          resolvedAt: FINAL_INCIDENT_STATUSES.includes(dto.status) ? new Date() : null,
        },
      });
      if (!count)
        throw new ConflictException({
          code: 'INCIDENT_ALREADY_DECIDED',
          message: 'Esta denúncia foi atualizada por outro administrador. Atualize a página.',
        });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'INCIDENT_UPDATED',
          entityType: 'Incident',
          entityId: id,
          metadata: {
            status: dto.status,
            previousStatus: current.status,
            note: dto.note ?? null,
          },
        },
      });
      return { id, status: dto.status, reportedById: current.reportedById };
    });

    // Fora da transação, e sem a justificativa: ela é registro interno.
    let notificationDelivered = true;
    try {
      await this.notifications.create({
        userId: incident.reportedById,
        type: NotificationType.INCIDENT_UPDATED,
        title: 'Incidente atualizado',
        message: 'O status do incidente reportado foi atualizado.',
        resourceType: 'INCIDENT',
        resourceId: incident.id,
        metadata: { status: dto.status },
      });
    } catch (error) {
      notificationDelivered = false;
      this.logger.error(
        `Falha ao notificar denunciante: ${error instanceof Error ? error.name : 'erro'}`,
      );
    }
    return { id: incident.id, status: incident.status, notificationDelivered };
  }

  async auditLogs(query: AdminAuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      // Checkpoints internos são mutáveis e não são eventos da auditoria administrativa.
      AND: [
        { entityType: { notIn: [...AUTH_STATE_ENTITY_TYPES] } },
        ...(query.entityType ? [{ entityType: query.entityType }] : []),
      ],
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { action: { contains: query.q, mode: 'insensitive' } },
              { entityId: { equals: query.q } },
              { actor: { is: { fullName: { contains: query.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true,
          actor: person,
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
