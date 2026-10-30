import { API_URL } from '../config';

// Textos das mensagens vêm da especificação de casos de uso (UC01 E03).
export const NETWORK_ERROR_MESSAGE =
  'Sem conexão com a internet. Verifique sua rede e tente novamente.';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function apiResponse(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Response> {
  const { token, headers, ...rest } = init;
  try {
    return await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        ...(rest.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
}

export async function throwApiResponseError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null);
  const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
  throw new ApiError(
    message ?? 'Algo deu errado. Tente novamente.',
    response.status,
  );
}

export async function api<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const response = await apiResponse(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      Array.isArray(body?.message) ? body.message[0] : body?.message ?? 'Algo deu errado. Tente novamente.',
      response.status,
    );
  return body as T;
}
