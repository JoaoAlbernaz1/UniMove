import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { encryptTwoFactorSecret } from '../auth/two-factor-crypto';

/** Rótulo do autenticador. Mudar aqui renomeia a entrada no app do usuário. */
export const TWO_FACTOR_ISSUER = 'UniCarona Admin';
export const RECOVERY_CODE_COUNT = 8;

export interface FactorProvisioning {
  /** Segredo em claro, devolvido uma única vez a quem está cadastrando. */
  secret: string;
  encryptedSecret: string;
  otpauthUri: string;
  qrCode: string;
}

/**
 * Gera segredo, URI e QR para um novo autenticador. Não escreve no banco: quem
 * chama decide em qual transação e em qual linha gravar `encryptedSecret`.
 */
export async function provisionFactor(email: string): Promise<FactorProvisioning> {
  const secret = generateSecret();
  const otpauthUri = generateURI({ secret, label: email, issuer: TWO_FACTOR_ISSUER });
  return {
    secret,
    encryptedSecret: encryptTwoFactorSecret(secret),
    otpauthUri,
    qrCode: await QRCode.toDataURL(otpauthUri),
  };
}

export function isTotpFormat(code: string) {
  return /^\d{6}$/.test(code);
}

export async function matchesTotp(secret: string, code: string) {
  if (!isTotpFormat(code)) return false;
  const result = await verify({ token: code, secret, epochTolerance: 30 });
  return result.valid;
}

/**
 * Códigos de recuperação em claro e seus hashes, na mesma ordem. Só os hashes
 * são persistidos; os códigos em claro são exibidos uma vez e descartados.
 */
export async function buildRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  const hashes = await Promise.all(
    codes.map((value) => argon2.hash(normalizeRecoveryCode(value), { type: argon2.argon2id })),
  );
  return { codes, hashes };
}

/** O usuário digita com ou sem hífen, em qualquer caixa: o hash é do canônico. */
export function normalizeRecoveryCode(code: string) {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}
