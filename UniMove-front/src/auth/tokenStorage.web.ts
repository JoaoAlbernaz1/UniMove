// O expo-secure-store não existe no navegador; aqui o refresh token fica no
// localStorage. Serve para desenvolvimento — o app de verdade roda no celular.
const KEY = 'unimove.refreshToken';

export const tokenStorage = {
  get: async () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: async (token: string) => {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      // Navegação anônima ou armazenamento bloqueado: a sessão vale só até recarregar.
    }
  },
  clear: async () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Idem.
    }
  },
};
