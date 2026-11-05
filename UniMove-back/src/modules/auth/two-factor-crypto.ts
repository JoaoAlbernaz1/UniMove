import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Chave histórica: está no repositório público, logo não protege nada. Continua
// aqui só para ler segredos já gravados com ela; escritas novas de administrador
// exigem TWO_FACTOR_ENCRYPTION_KEY (ver isTwoFactorKeyConfigured).
const LEGACY_SEED = 'unimove-development-two-factor-key';

function keyFrom(seed: string) {
  return createHash('sha256').update(seed).digest();
}

function currentSeed() {
  return process.env.TWO_FACTOR_ENCRYPTION_KEY || process.env.AUTH_REFRESH_SECRET || LEGACY_SEED;
}

export function isTwoFactorKeyConfigured() {
  return Boolean(process.env.TWO_FACTOR_ENCRYPTION_KEY);
}

export function encryptTwoFactorSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(currentSeed()), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

/** `legacy` indica que o segredo deve ser recifrado com a chave atual. */
export function decryptTwoFactorSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Segredo 2FA malformado.');
  const seeds = [...new Set([currentSeed(), process.env.AUTH_REFRESH_SECRET, LEGACY_SEED])].filter(
    (seed): seed is string => Boolean(seed),
  );
  for (const seed of seeds) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        keyFrom(seed),
        Buffer.from(ivValue, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
      const secret = Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      return { secret, legacy: seed !== process.env.TWO_FACTOR_ENCRYPTION_KEY };
    } catch {
      // Tag GCM não confere com esta chave: tenta a próxima.
    }
  }
  throw new Error('Segredo 2FA não pôde ser decifrado.');
}
