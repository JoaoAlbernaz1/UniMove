export const configuration = () => ({
  app: {
    port: Number(process.env.PORT ?? 3000),
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    maxPageSize: Number(process.env.MAX_PAGE_SIZE ?? 100),
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
  return config;
}
