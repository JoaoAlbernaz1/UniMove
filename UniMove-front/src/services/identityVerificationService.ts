import { Platform } from 'react-native';
import type { DocumentPickerAsset } from 'expo-document-picker';

export type IdentityVerificationStatus = {
  emailVerified: boolean;
  resendAvailableAt: string | null;
  academic: {
    status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
    submittedAt: string;
    reviewedAt: string | null;
    reviewNote: string | null;
  } | null;
};

type AuthApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export function getIdentityVerificationStatus(authApi: AuthApi) {
  return authApi<IdentityVerificationStatus>('/users/me/verification');
}

export function sendIdentityVerificationCode(authApi: AuthApi) {
  return authApi<{
    sent: boolean;
    expiresAt: string;
    resendAvailableAt: string;
  }>('/users/me/verification/email/code', { method: 'POST' });
}

export function verifyInstitutionalEmail(authApi: AuthApi, code: string) {
  return authApi<{ verified: boolean }>(
    '/users/me/verification/email/confirm',
    {
      method: 'POST',
      body: JSON.stringify({ code }),
    },
  );
}

export function submitAcademicDocument(
  authApi: AuthApi,
  document: DocumentPickerAsset,
) {
  const form = new FormData();
  if (Platform.OS === 'web' && document.file) {
    form.append('document', document.file);
  } else {
    form.append('document', {
      uri: document.uri,
      name: document.name,
      type: document.mimeType ?? 'application/pdf',
    } as unknown as Blob);
  }
  return authApi<{
    status: 'PENDING_REVIEW';
    submittedAt: string;
    message: string;
  }>('/users/me/verification/academic-document', {
    method: 'POST',
    body: form,
  });
}
