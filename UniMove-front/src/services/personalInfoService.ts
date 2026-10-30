import { Platform } from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { ApiError, throwApiResponseError } from '../api/client';

export type PersonalInfo = {
  id: string;
  fullName: string;
  institutionalEmail: string;
  studentNumber: string | null;
  cpf: string;
  profilePhoto: { updatedAt: string } | null;
};

export type PersonalInfoChanges = {
  fullName?: string;
  studentNumber?: string | null;
};

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

type AuthApi = <T>(path: string, init?: RequestInit) => Promise<T>;
type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

export function getPersonalInfo(authApi: AuthApi) {
  return authApi<PersonalInfo>('/users/me/personal-info');
}

export async function getProfilePhoto(authFetch: AuthFetch) {
  const response = await authFetch('/users/me/personal-info/photo');
  if (response.status === 404) return null;
  if (!response.ok) return throwApiResponseError(response);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new ApiError('Não foi possível carregar sua foto.', 0));
    };
    reader.onerror = () =>
      reject(new ApiError('Não foi possível carregar sua foto.', 0));
    reader.readAsDataURL(blob);
  });
}

function personalInfoForm(
  changes: PersonalInfoChanges,
  photo: ImagePickerAsset | null,
) {
  const form = new FormData();
  form.append('data', JSON.stringify(changes));
  if (photo) {
    if (Platform.OS === 'web' && photo.file) {
      form.append('photo', photo.file);
    } else {
      form.append(
        'photo',
        {
          uri: photo.uri,
          name: photo.fileName ?? 'profile-photo.jpg',
          type: photo.mimeType ?? 'image/jpeg',
        } as unknown as Blob,
      );
    }
  }
  return form;
}

export function updatePersonalInfo(
  authApi: AuthApi,
  changes: PersonalInfoChanges,
  photo: ImagePickerAsset | null,
) {
  return authApi<PersonalInfo>('/users/me/personal-info', {
    method: 'PATCH',
    body: personalInfoForm(changes, photo),
  });
}

export function changePassword(authApi: AuthApi, input: ChangePasswordInput) {
  return authApi<{ changed: boolean }>('/users/me/password', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
