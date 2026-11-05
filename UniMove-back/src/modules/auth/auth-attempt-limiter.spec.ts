import { HttpException } from '@nestjs/common';
import { AuthAttemptLimiter } from './auth-attempt-limiter';

describe('AuthAttemptLimiter', () => {
  it('trava depois de 8 falhas e libera quando a janela passa', () => {
    const limiter = new AuthAttemptLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 8; i += 1) {
      limiter.assertAllowed('login:a', now);
      limiter.recordFailure('login:a', now);
    }
    expect(() => limiter.assertAllowed('login:a', now)).toThrow(HttpException);
    expect(() => limiter.assertAllowed('login:b', now)).not.toThrow();
    expect(() => limiter.assertAllowed('login:a', now + 16 * 60 * 1000)).not.toThrow();
  });

  it('sucesso zera a contagem', () => {
    const limiter = new AuthAttemptLimiter();
    for (let i = 0; i < 8; i += 1) limiter.recordFailure('login:a');
    limiter.reset('login:a');
    expect(() => limiter.assertAllowed('login:a')).not.toThrow();
  });

  it('código só pode ser usado uma vez por conta, dentro da validade', () => {
    const limiter = new AuthAttemptLimiter();
    const now = 1_000_000;
    expect(limiter.claimCode('user-1', '123456', now)).toBe(true);
    expect(limiter.claimCode('user-1', '123456', now + 1000)).toBe(false);
    expect(limiter.claimCode('user-2', '123456', now + 1000)).toBe(true);
    expect(limiter.claimCode('user-1', '123456', now + 3 * 60 * 1000)).toBe(true);
  });
});
