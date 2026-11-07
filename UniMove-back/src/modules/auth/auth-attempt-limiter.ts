import { createHmac } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;
// 30-second TOTP steps with epochTolerance=30 can remain accepted for about
// 90 seconds. Keep consumption for 120 seconds, including across restarts.
const CODE_REUSE_MS = 120_000;
export const AUTH_STATE_ENTITY_TYPES = ['AuthAttemptLimit', 'AuthCodeClaim'] as const;
const [ATTEMPT_ENTITY, CODE_ENTITY] = AUTH_STATE_ENTITY_TYPES;
type StateRow = { id: string; metadata: Prisma.JsonValue };

/**
 * Shared account-level protection in addition to the IP throttler. Dedicated
 * audit entity types hold one mutable checkpoint per HMAC fingerprint; unrelated
 * audit events are never changed or deleted. Reads use the existing composite
 * (entityType, entityId) index, without scanning the audit history.
 *
 * Checkpoints are retained (and reused) indefinitely: cardinality grows with
 * distinct attempted keys and user/code pairs, not with every request. Any future
 * retention job must target only these entity types and preserve active windows.
 * All instances must share auth.accessSecret; rotating it invalidates fingerprints.
 */
@Injectable()
export class AuthAttemptLimiter {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('auth.accessSecret');
  }

  async assertAllowed(key: string, now = Date.now()): Promise<void> {
    await this.withState(ATTEMPT_ENTITY, this.fingerprint('attempt', key), (_tx, row) => {
      if (this.number(row, 'expiresAt') > now && this.number(row, 'failureCount') >= MAX_FAILURES) {
        throw new HttpException(
          { code: 'ADMIN_LOGIN_LOCKED', message: 'Muitas tentativas. Aguarde alguns minutos.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return Promise.resolve();
    });
  }

  async recordFailure(key: string, now = Date.now()): Promise<void> {
    const fingerprint = this.fingerprint('attempt', key);
    await this.withState(ATTEMPT_ENTITY, fingerprint, async (tx, row) => {
      const expiresAt = this.number(row, 'expiresAt');
      const previousCount = expiresAt > now ? this.number(row, 'failureCount') : 0;
      // Already-blocked in-flight requests do not extend the lock indefinitely.
      if (previousCount >= MAX_FAILURES) return;
      const failureCount = previousCount + 1;
      await this.save(tx, row, ATTEMPT_ENTITY, fingerprint, 'AUTH_ATTEMPT_FAILED', {
        fingerprint,
        failureCount,
        // Give a full 15-minute block from the eighth failure. Before that,
        // retain the existing 15-minute counting window from the first failure.
        expiresAt:
          failureCount === MAX_FAILURES || previousCount === 0 ? now + WINDOW_MS : expiresAt,
      });
    });
  }

  async reset(key: string): Promise<void> {
    const fingerprint = this.fingerprint('attempt', key);
    await this.withState(ATTEMPT_ENTITY, fingerprint, async (tx, row) => {
      if (!row) return;
      await this.save(tx, row, ATTEMPT_ENTITY, fingerprint, 'AUTH_ATTEMPT_RESET', {
        fingerprint,
        failureCount: 0,
        expiresAt: 0,
      });
    });
  }

  async claimCode(userId: string, code: string, now = Date.now()): Promise<boolean> {
    const fingerprint = this.fingerprint('code', userId, code);
    return this.withState(CODE_ENTITY, fingerprint, async (tx, row) => {
      if (this.number(row, 'expiresAt') > now) return false;
      await this.save(tx, row, CODE_ENTITY, fingerprint, 'AUTH_CODE_CLAIMED', {
        fingerprint,
        expiresAt: now + CODE_REUSE_MS,
      });
      return true;
    });
  }

  private fingerprint(domain: string, ...parts: string[]): string {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify([domain, ...parts]))
      .digest('hex');
  }

  private number(row: StateRow | null, field: string): number {
    const metadata = row?.metadata;
    const value =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata[field]
        : undefined;
    return typeof value === 'number' ? value : 0;
  }

  private async withState<T>(
    entityType: string,
    fingerprint: string,
    run: (tx: Prisma.TransactionClient, row: StateRow | null) => Promise<T>,
  ): Promise<T> {
    // A transaction lock also protects first creation: no schema uniqueness
    // change is needed. The 64-bit HMAC prefix avoids exposing raw identifiers.
    // A collision would only serialize unrelated subjects, never share state.
    const lockId = BigInt.asIntN(64, BigInt(`0x${fingerprint.slice(0, 16)}`));
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId}::bigint)`;
      const row = await tx.auditLog.findFirst({
        where: { entityType, entityId: fingerprint },
        select: { id: true, metadata: true },
      });
      return run(tx, row);
    });
  }

  private async save(
    tx: Prisma.TransactionClient,
    row: StateRow | null,
    entityType: string,
    fingerprint: string,
    action: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    if (row) {
      await tx.auditLog.update({ where: { id: row.id }, data: { action, metadata } });
    } else {
      await tx.auditLog.create({
        data: { action, entityType, entityId: fingerprint, actorUserId: null, metadata },
      });
    }
  }
}
