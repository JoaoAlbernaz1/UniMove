import { validateEnvironment } from './configuration';

const base = {
  DATABASE_URL: 'postgresql://fixture@localhost/unimove_test',
  JWT_ACCESS_SECRET: 'test-only-access-key-000000000000000',
  JWT_REFRESH_SECRET: 'test-only-refresh-key-00000000000000',
};

describe('administrative environment validation', () => {
  it('requires a dedicated encryption key before production starts', () => {
    expect(() => validateEnvironment({ ...base, NODE_ENV: 'production' })).toThrow(
      'TWO_FACTOR_ENCRYPTION_KEY',
    );
    expect(() => validateEnvironment({ ...base, TWO_FACTOR_ENCRYPTION_KEY: 'short' })).toThrow(
      'TWO_FACTOR_ENCRYPTION_KEY',
    );
  });

  it.each([
    '*',
    'https://*.vercel.app',
    'https://panel.test/path',
    'https://user:password@panel.test',
    'http://panel.test',
  ])('rejects an unsafe production panel origin: %s', (origin) => {
    expect(() =>
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        TWO_FACTOR_ENCRYPTION_KEY: 'test-only-factor-key-000000000000000',
        ADMIN_PANEL_ORIGINS: origin,
      }),
    ).toThrow('ADMIN_PANEL_ORIGINS');
  });

  it('accepts explicit HTTPS origins and localhost only in development', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        TWO_FACTOR_ENCRYPTION_KEY: 'test-only-factor-key-000000000000000',
        ADMIN_PANEL_ORIGINS: 'https://panel.test,https://preview.test',
      }),
    ).not.toThrow();
    expect(() =>
      validateEnvironment({ ...base, ADMIN_PANEL_ORIGINS: 'http://localhost:5173' }),
    ).not.toThrow();
  });

  it.each(['0', '-1', 'NaN', '25'])('rejects an invalid maximum session duration: %s', (hours) => {
    expect(() => validateEnvironment({ ...base, ADMIN_SESSION_MAX_HOURS: hours })).toThrow(
      'ADMIN_SESSION_MAX_HOURS',
    );
  });
});
