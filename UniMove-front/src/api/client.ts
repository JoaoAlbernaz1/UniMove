import { API_URL } from '../config';

// Textos das mensagens vêm da especificação de casos de uso (UC01 E03).
export const NETWORK_ERROR_MESSAGE = 'Sem conexão com a internet. Verifique sua rede e tente novamente.';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // O backend responde { message: string | string[] } em português.
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new ApiError(message ?? 'Algo deu errado. Tente novamente.', response.status);
  }
  return body as T;
}
