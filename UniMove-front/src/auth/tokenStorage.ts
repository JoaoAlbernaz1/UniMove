import * as SecureStore from 'expo-secure-store';

// Android/iOS: refresh token no armazenamento seguro do sistema (Keychain/Keystore).
// No navegador o Metro usa tokenStorage.web.ts no lugar deste arquivo.
const KEY = 'unimove.refreshToken';

export const tokenStorage = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token: string) => SecureStore.setItemAsync(KEY, token),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
