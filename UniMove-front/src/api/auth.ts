import { api } from './client';

export type Tokens = { accessToken: string; refreshToken: string; expiresIn: number };

export type Me = { id: string; fullName: string; institutionalEmail: string };

export function login(email: string, password: string) {
  return api<Tokens>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
}

export function refresh(refreshToken: string) {
  return api<Tokens>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) });
}

export function logout(refreshToken: string) {
  return api<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) });
}
