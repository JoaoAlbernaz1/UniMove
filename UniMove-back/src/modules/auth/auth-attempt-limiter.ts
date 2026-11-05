import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;
const CODE_REUSE_MS = 2 * 60 * 1000;
const MAX_TRACKED_KEYS = 10_000;

/**
 * Freio por conta para login e segundo fator, no app e no painel, somado ao limite por IP do
 * ThrottlerGuard. Em memória: a API roda em uma instância no Render; com mais de
 * uma, o limite passa a valer por instância.
 */
@Injectable()
export class AuthAttemptLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();
  private readonly usedCodes = new Map<string, number>();

  assertAllowed(key: string, now = Date.now()) {
    const entry = this.failures.get(key);
    if (entry && entry.resetAt > now && entry.count >= MAX_FAILURES)
      throw new HttpException(
        { code: 'ADMIN_LOGIN_LOCKED', message: 'Muitas tentativas. Aguarde alguns minutos.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  recordFailure(key: string, now = Date.now()) {
    if (this.failures.size >= MAX_TRACKED_KEYS) this.prune(now);
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now)
      this.failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
    else entry.count += 1;
  }

  reset(key: string) {
    this.failures.delete(key);
  }

  /** Código TOTP vale uma única vez, mesmo dentro da janela de validade. */
  claimCode(userId: string, code: string, now = Date.now()) {
    const key = `${userId}:${code}`;
    const expiresAt = this.usedCodes.get(key);
    if (expiresAt && expiresAt > now) return false;
    if (this.usedCodes.size >= MAX_TRACKED_KEYS) this.prune(now);
    this.usedCodes.set(key, now + CODE_REUSE_MS);
    return true;
  }

  private prune(now: number) {
    for (const [key, entry] of this.failures) if (entry.resetAt <= now) this.failures.delete(key);
    for (const [key, expiresAt] of this.usedCodes) if (expiresAt <= now) this.usedCodes.delete(key);
  }
}
