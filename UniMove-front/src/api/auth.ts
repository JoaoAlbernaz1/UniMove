import { api } from './client';
import type { LegalDocument } from '../legal';

export type RegistrationPolicy = {
  termsVersion: string;
  privacyPolicyVersion: string;
  passwordRequirements: string[];
  institutionalDomains: string[];
  termsOfUse: LegalDocument;
  privacyPolicy: LegalDocument;
};
export function registrationPolicy() {
  return api<RegistrationPolicy>('/auth/registration-policy');
}

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type Me = {
  id: string;
  fullName: string;
  institutionalEmail: string;
  roles?: { role: { name: string } }[];
};

export function login(email: string, password: string) {
  return api<Tokens>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
}

export type RegisterInput = {
  fullName: string;
  cpf: string;
  institutionalEmail: string;
  password: string;
  passwordConfirmation: string;
  acceptedTerms: boolean;
  termsVersion: string;
  privacyPolicyVersion: string;
};

export function register(input: RegisterInput) {
  return api<Me>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function refresh(refreshToken: string) {
  return api<Tokens>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export function logout(refreshToken: string) {
  return api<void>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}
