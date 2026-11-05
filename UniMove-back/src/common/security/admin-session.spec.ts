import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import {
  adminCookieNames,
  adminCookieOptions,
  assertAdminCsrf,
  assertAdminOrigin,
  isUnsafeMethod,
} from './admin-session';

const requestWith = (headers: Record<string, string>, cookies: Record<string, string> = {}) =>
  ({ headers, cookies }) as unknown as Request;

describe('sessão administrativa', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('só aceita origens configuradas, e nega tudo sem configuração', () => {
    const allowed = ['https://admin.exemplo.app'];
    expect(() =>
      assertAdminOrigin(requestWith({ origin: 'https://admin.exemplo.app' }), allowed),
    ).not.toThrow();
    expect(() => assertAdminOrigin(requestWith({ origin: 'https://evil.test' }), allowed)).toThrow(
      ForbiddenException,
    );
    expect(() => assertAdminOrigin(requestWith({}), allowed)).toThrow(ForbiddenException);
    expect(() =>
      assertAdminOrigin(requestWith({ origin: 'https://admin.exemplo.app' }), []),
    ).toThrow(ForbiddenException);
  });

  it('CSRF exige cabeçalho igual ao cookie', () => {
    const name = adminCookieNames().csrf;
    expect(() =>
      assertAdminCsrf(requestWith({ 'x-csrf-token': 'abc' }, { [name]: 'abc' })),
    ).not.toThrow();
    for (const request of [
      requestWith({}, { [name]: 'abc' }),
      requestWith({ 'x-csrf-token': 'abc' }),
      requestWith({ 'x-csrf-token': 'abd' }, { [name]: 'abc' }),
      requestWith({ 'x-csrf-token': 'ab' }, { [name]: 'abc' }),
    ])
      expect(() => assertAdminCsrf(request)).toThrow(ForbiddenException);
  });

  it('classifica métodos que alteram estado', () => {
    expect(['GET', 'HEAD', 'OPTIONS'].some(isUnsafeMethod)).toBe(false);
    expect(['POST', 'PATCH', 'PUT', 'DELETE'].every(isUnsafeMethod)).toBe(true);
  });

  it('em produção usa prefixos e cookies Secure; só o CSRF é legível por script', () => {
    process.env.NODE_ENV = 'production';
    expect(adminCookieNames().access).toBe('__Host-uc_admin_at');
    expect(adminCookieNames().csrf).toBe('__Host-uc_admin_csrf');
    expect(adminCookieNames().refresh).toBe('__Secure-uc_admin_rt');
    expect(adminCookieOptions.access()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
    expect(adminCookieOptions.refresh()).toMatchObject({
      httpOnly: true,
      path: '/api/v1/admin/auth',
    });
    expect(adminCookieOptions.csrf()).toMatchObject({ httpOnly: false, secure: true });
  });
});
