import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  isTwoFactorKeyConfigured,
} from './two-factor-crypto';

function encryptWithSeed(secret: string, seed: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(seed).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

describe('cifra do segredo 2FA', () => {
  const original = process.env.TWO_FACTOR_ENCRYPTION_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
    else process.env.TWO_FACTOR_ENCRYPTION_KEY = original;
  });

  it('cifra e decifra com a chave configurada', () => {
    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'chave-de-teste-com-tamanho-suficiente';
    const stored = encryptTwoFactorSecret('SEGREDO');
    expect(stored).not.toContain('SEGREDO');
    expect(decryptTwoFactorSecret(stored)).toEqual({ secret: 'SEGREDO', legacy: false });
    expect(isTwoFactorKeyConfigured()).toBe(true);
  });

  it('ainda lê segredo antigo e sinaliza que precisa ser recifrado', () => {
    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'chave-de-teste-com-tamanho-suficiente';
    const stored = encryptWithSeed('ANTIGO', 'unimove-development-two-factor-key');
    expect(decryptTwoFactorSecret(stored)).toEqual({ secret: 'ANTIGO', legacy: true });
  });

  it('não decifra com chave desconhecida nem valor adulterado', () => {
    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'chave-de-teste-com-tamanho-suficiente';
    expect(() => decryptTwoFactorSecret(encryptWithSeed('X', 'outra-chave-qualquer'))).toThrow();
    expect(() => decryptTwoFactorSecret('malformado')).toThrow();
  });

  it('informa quando a chave não está configurada', () => {
    delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
    expect(isTwoFactorKeyConfigured()).toBe(false);
  });

  it('não considera uma chave vazia ou curta adequada para provisionamento', () => {
    process.env.TWO_FACTOR_ENCRYPTION_KEY = ' '.repeat(32);
    expect(isTwoFactorKeyConfigured()).toBe(false);
    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'curta';
    expect(isTwoFactorKeyConfigured()).toBe(false);
  });

  it('recusa nova escrita em produção sem chave dedicada mesmo com JWT configurado', () => {
    const nodeEnv = process.env.NODE_ENV;
    const refresh = process.env.AUTH_REFRESH_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_REFRESH_SECRET = 'jwt-ficticio-que-nao-deve-ser-alterado';
      delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
      expect(() => encryptTwoFactorSecret('NOVO')).toThrow();
      expect(
        decryptTwoFactorSecret(encryptWithSeed('ANTIGO', process.env.AUTH_REFRESH_SECRET)),
      ).toEqual({ secret: 'ANTIGO', legacy: true });
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      if (refresh === undefined) delete process.env.AUTH_REFRESH_SECRET;
      else process.env.AUTH_REFRESH_SECRET = refresh;
    }
  });
});
