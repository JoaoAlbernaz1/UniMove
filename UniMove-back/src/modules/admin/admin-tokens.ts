import { createHash, randomBytes } from 'node:crypto';

/** 32 bytes aleatórios em base64url: 256 bits de entropia, seguro em URL. */
export function issueToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/**
 * SHA-256 do token. Serve para buscar pelo índice único sem guardar o segredo:
 * um vazamento do banco não entrega nenhum link válido. Não é argon2 de
 * propósito — o token tem entropia alta e a busca precisa ser por igualdade.
 */
export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** Link que vai no e-mail. O token nunca é gravado nem registrado em log. */
export function buildPanelUrl(baseUrl: string, path: string, token: string) {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('token', token);
  return url.toString();
}
