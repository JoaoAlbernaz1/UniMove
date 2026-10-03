// Em emulador Android, localhost é o próprio emulador: use
// EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api/v1 no .env.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

// UC01 RN04: só e-mails de domínio institucional reconhecido. Precisa bater com
// ALLOWED_INSTITUTIONAL_EMAIL_DOMAINS do backend.
export const ALLOWED_EMAIL_DOMAINS = (process.env.EXPO_PUBLIC_ALLOWED_EMAIL_DOMAINS ?? 'ucb.edu.br')
  .split(',')
  .map((domain: string) => domain.trim().toLowerCase())
  .filter(Boolean);
