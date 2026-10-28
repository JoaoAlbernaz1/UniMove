export type RideLocation = { id: string; name: string };
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
