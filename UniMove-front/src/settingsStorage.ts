import * as SecureStore from 'expo-secure-store';

export function loadSettings<T>(key: string, fallback: T): Promise<T> {
  return SecureStore.getItemAsync(key).then((value) => {
    if (!value) return fallback;
    try {
      return { ...fallback, ...JSON.parse(value) } as T;
    } catch {
      return fallback;
    }
  });
}

export function saveSettings<T>(key: string, value: T): Promise<void> {
  return SecureStore.setItemAsync(key, JSON.stringify(value));
}
