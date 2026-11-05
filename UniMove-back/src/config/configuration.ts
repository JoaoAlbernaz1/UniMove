import { parseProxyHops } from './proxy-trust';

export const configuration = () => ({
  app: {
    port: Number(process.env.PORT ?? 3000),
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    maxPageSize: Number(process.env.MAX_PAGE_SIZE ?? 100),
    trustProxyHops: parseProxyHops(process.env.TRUST_PROXY_HOPS),
  },
  auth: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION ?? '30d',
    institutionalDomains: (process.env.ALLOWED_INSTITUTIONAL_EMAIL_DOMAINS ?? '')
      .split(',')
      .filter(Boolean),
  },
  admin: {
    // Origens do painel, conferidas nas escritas feitas com cookie de sessão.
    origins: (process.env.ADMIN_PANEL_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    sessionMaxHours: Number(process.env.ADMIN_SESSION_MAX_HOURS ?? 12),
  },
  rides: { requestExpirationMinutes: Number(process.env.RIDE_REQUEST_EXPIRATION_MINUTES ?? 15) },
  matching: { toleranceMinutes: Number(process.env.MATCHING_TIME_TOLERANCE_MINUTES ?? 30) },
});

export function validateEnvironment(config: Record<string, unknown>) {
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (String(config[key]).length < 32) throw new Error(`${key} must have at least 32 characters`);
  }
  const factorKey = config.TWO_FACTOR_ENCRYPTION_KEY;
  if (config.NODE_ENV === 'production' || factorKey) {
    if (typeof factorKey !== 'string' || factorKey.trim().length < 32)
      throw new Error('TWO_FACTOR_ENCRYPTION_KEY must have at least 32 characters');
  }
  const origins = config.ADMIN_PANEL_ORIGINS;
  if (origins !== undefined && typeof origins !== 'string')
    throw new Error('ADMIN_PANEL_ORIGINS must be a comma-separated string');
  for (const origin of (origins ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)) {
    let valid: boolean;
    try {
      const parsed = new URL(origin);
      valid =
        !origin.includes('*') &&
        parsed.origin === origin &&
        (parsed.protocol === 'https:' ||
          (config.NODE_ENV !== 'production' && parsed.protocol === 'http:'));
    } catch {
      valid = false;
    }
    if (!valid)
      throw new Error('ADMIN_PANEL_ORIGINS must contain explicit origins (HTTPS in production)');
  }
  const hours = Number(config.ADMIN_SESSION_MAX_HOURS ?? 12);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24)
    throw new Error('ADMIN_SESSION_MAX_HOURS must be an integer between 1 and 24');
  parseProxyHops(config.TRUST_PROXY_HOPS);
  return config;
}
