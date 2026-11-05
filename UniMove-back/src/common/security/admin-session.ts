import { ForbiddenException } from '@nestjs/common';
import type { CookieOptions, Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

export const ADMIN_API_PATH = '/api/v1/admin';
export const ADMIN_AUTH_PATH = `${ADMIN_API_PATH}/auth`;
export const ADMIN_CSRF_HEADER = 'x-csrf-token';

/**
 * Sessão do painel: cookies de primeira parte, servidos pela origem do próprio
 * painel (rewrite da Vercel ou proxy do Vite). Nada de token em localStorage.
 * Os prefixos __Host-/__Secure- só valem em HTTPS, por isso ficam em produção.
 */
export function adminCookieNames() {
  const production = process.env.NODE_ENV === 'production';
  return {
    access: production ? '__Host-uc_admin_at' : 'uc_admin_at',
    csrf: production ? '__Host-uc_admin_csrf' : 'uc_admin_csrf',
    refresh: production ? '__Secure-uc_admin_rt' : 'uc_admin_rt',
    challenge: production ? '__Secure-uc_admin_ch' : 'uc_admin_ch',
  };
}

function baseCookie(path: string, maxAge?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path,
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

export const adminCookieOptions = {
  access: (maxAge?: number) => baseCookie('/', maxAge),
  refresh: (maxAge?: number) => baseCookie(ADMIN_AUTH_PATH, maxAge),
  challenge: (maxAge?: number) => baseCookie(ADMIN_AUTH_PATH, maxAge),
  // Legível pelo JavaScript do painel de propósito: é o par do double-submit.
  csrf: (maxAge?: number) => ({ ...baseCookie('/', maxAge), httpOnly: false }),
};

export function isUnsafeMethod(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export function assertAdminOrigin(request: Request, allowedOrigins: string[] | undefined) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins?.includes(origin))
    throw new ForbiddenException({
      code: 'ADMIN_ORIGIN_REJECTED',
      message: 'Origem não autorizada para o painel administrativo.',
    });
}

export function assertAdminCsrf(request: Request) {
  const header = request.headers[ADMIN_CSRF_HEADER];
  const cookies = request.cookies as Record<string, string> | undefined;
  const cookie = cookies?.[adminCookieNames().csrf];
  if (typeof header !== 'string' || !cookie || !safeEqual(header, cookie))
    throw new ForbiddenException({
      code: 'ADMIN_CSRF_REJECTED',
      message: 'Falha na verificação de segurança da requisição.',
    });
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
