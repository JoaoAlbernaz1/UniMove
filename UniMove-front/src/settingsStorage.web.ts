export function loadSettings<T>(key: string, fallback: T): Promise<T> {
  const value = globalThis.localStorage?.getItem(key);
  if (!value) return Promise.resolve(fallback);
  try {
    return Promise.resolve({ ...fallback, ...JSON.parse(value) } as T);
  } catch {
    return Promise.resolve(fallback);
  }
}

export function saveSettings<T>(key: string, value: T): Promise<void> {
  globalThis.localStorage?.setItem(key, JSON.stringify(value));
  return Promise.resolve();
}
