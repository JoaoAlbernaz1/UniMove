import { Platform } from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';

export type VehicleRegistrationPolicy = {
  driverLicense: { required: boolean; maxBytes: number; formats: string[] };
  minYear: number;
  maxYear: number;
  minPassengerCapacity: number;
  maxPassengerCapacity: number;
  fieldMaxLengths: {
    brand: number;
    model: number;
    color: number;
    plate: number;
    year: number;
  };
};

export type CreateVehicleInput = {
  brand: string;
  model: string;
  color: string;
  plate: string;
  year: number;
  passengerCapacity: number;
};

export type Vehicle = CreateVehicleInput & { id: string; active: boolean };

type AuthApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export function getVehicleRegistrationPolicy(authApi: AuthApi) {
  return authApi<VehicleRegistrationPolicy>('/vehicles/registration-policy');
}

function vehicleForm(
  input: CreateVehicleInput,
  photo?: ImagePickerAsset | null,
) {
  const form = new FormData();
  form.append('data', JSON.stringify(input));
  if (photo) {
    if (Platform.OS === 'web' && photo.file)
      form.append('driverLicense', photo.file);
    else
      form.append('driverLicense', {
        uri: photo.uri,
        name: photo.fileName ?? 'cnh.jpg',
        type: photo.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
  }
  return form;
}

export function getDriverLicense(authApi: AuthApi) {
  return authApi<{ uploaded: boolean; updatedAt: string | null }>(
    '/vehicles/driver-license',
  );
}

export function createVehicle(
  authApi: AuthApi,
  input: CreateVehicleInput,
  photo?: ImagePickerAsset | null,
) {
  return authApi<Vehicle>('/vehicles', {
    method: 'POST',
    body: vehicleForm(input, photo),
  });
}

export function getVehicles(authApi: AuthApi) {
  return authApi<Vehicle[]>('/vehicles');
}

export function updateVehicle(
  authApi: AuthApi,
  id: string,
  input: CreateVehicleInput,
  photo?: ImagePickerAsset | null,
) {
  return authApi<Vehicle>(`/vehicles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: vehicleForm(input, photo),
  });
}
