import type { Express } from 'express';

/** Aceita só conexão direta ou um proxy de entrada confiável, nunca trust=true. */
export function parseProxyHops(value: unknown): 0 | 1 {
  if (value === undefined || value === '') return 0;
  if (value === '0' || value === 0) return 0;
  if (value === '1' || value === 1) return 1;
  throw new Error('TRUST_PROXY_HOPS must be 0 or 1');
}

export function configureProxyTrust(app: Pick<Express, 'set'>, hops: 0 | 1) {
  app.set('trust proxy', hops === 0 ? false : 1);
}
