// Em emulador Android, localhost é o próprio emulador: use
// EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api/v1 no .env.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
