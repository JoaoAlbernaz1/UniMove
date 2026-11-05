export type RideLocation = { id: string; name: string; latitude?: number | null; longitude?: number | null };
export type RideVehicle = {
  id: string;
  brand: string;
  model: string;
  plate: string;
  passengerCapacity: number;
};

export type CreateRideInput = {
  originLocationId: string;
  destinationLocationId: string;
  vehicleId: string;
  departureAt: string;
  timezone: string;
  availableSeats: number;
  pricePerPersonCents: number;
  additionalInfo?: string;
  acceptsLuggage: boolean;
  allowsMusic: boolean;
  acceptsPets: boolean;
};

export type PublishedRide = { id: string; departureAt: string };

export type RideRequest = {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  seatsRequested: number;
  expiresAt: string;
  reservation?: { status: string } | null;
};

export type RideDetails = {
  id: string;
  departureAt: string;
  status: string;
  availableSeats: number;
  pricePerPersonCents: number;
  additionalInfo: string | null;
  acceptsLuggage: boolean;
  allowsMusic: boolean;
  acceptsPets: boolean;
  driver: { id: string; fullName: string };
  vehicle: { brand: string; model: string; color: string; year: number };
  originLocation: RideLocation;
  destinationLocation: RideLocation;
  request: RideRequest | null;
  canRequest: boolean;
  isDriver: boolean;
};

type AuthApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export function getRideDetails(authApi: AuthApi, id: string) {
  return authApi<RideDetails>(`/rides/${encodeURIComponent(id)}/details`);
}

export function requestRide(authApi: AuthApi, id: string) {
  return authApi<RideRequest>(`/rides/${encodeURIComponent(id)}/requests`, {
    method: 'POST', body: JSON.stringify({ seats: 1 }),
  });
}
