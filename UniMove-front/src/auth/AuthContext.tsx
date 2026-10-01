import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as authApi from '../api/auth';
import { api, ApiError } from '../api/client';
import { tokenStorage } from './tokenStorage';

type Status = 'loading' | 'signedOut' | 'signedIn';

type AuthContextValue = {
  status: Status;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  // Chamada autenticada: renova o access token (15 min) sozinha quando expira.
  authApi: <T>(path: string, init?: RequestInit) => Promise<T>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const tokensRef = useRef<authApi.Tokens | null>(null);
  // O backend gira o refresh token a cada uso e revoga o anterior. Duas renovações
  // em paralelo com o mesmo token derrubariam a sessão, então só uma roda por vez.
  const refreshingRef = useRef<Promise<authApi.Tokens | null> | null>(null);

  const storeTokens = useCallback(async (tokens: authApi.Tokens | null) => {
    tokensRef.current = tokens;
    if (tokens) await tokenStorage.set(tokens.refreshToken);
    else await tokenStorage.clear();
    setStatus(tokens ? 'signedIn' : 'signedOut');
  }, []);

  const renew = useCallback(() => {
    refreshingRef.current ??= (async () => {
      const refreshToken = tokensRef.current?.refreshToken ?? (await tokenStorage.get());
      if (!refreshToken) {
        await storeTokens(null);
        return null;
      }
      try {
        const tokens = await authApi.refresh(refreshToken);
        await storeTokens(tokens);
        return tokens;
      } catch (e) {
        // Sem internet não é motivo para deslogar: mantém o token para tentar depois.
        if (e instanceof ApiError && e.status === 0) throw e;
        await storeTokens(null);
        return null;
      }
    })().finally(() => {
      refreshingRef.current = null;
    });
    return refreshingRef.current;
  }, [storeTokens]);

  // UC11: ao abrir o app, retoma a sessão salva em vez de pedir login de novo.
  useEffect(() => {
    renew().catch(() => setStatus('signedOut'));
  }, [renew]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await storeTokens(await authApi.login(email, password));
    },
    [storeTokens],
  );

  const signOut = useCallback(async () => {
    const refreshToken = tokensRef.current?.refreshToken;
    await storeTokens(null);
    if (refreshToken) await authApi.logout(refreshToken).catch(() => {});
  }, [storeTokens]);

  const authenticatedApi = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = tokensRef.current?.accessToken;
      try {
        return await api<T>(path, { ...init, token });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) throw e;
        const tokens = await renew();
        if (!tokens) throw new ApiError('Sua sessão expirou. Entre novamente.', 401);
        return api<T>(path, { ...init, token: tokens.accessToken });
      }
    },
    [renew],
  );

  const value = useMemo(
    () => ({ status, signIn, signOut, authApi: authenticatedApi }),
    [status, signIn, signOut, authenticatedApi],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return context;
}
