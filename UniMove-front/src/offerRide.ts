import type { CreateRideInput } from './api/rides';

export type OfferRideDraft = {
  originLocationId: string;
  destinationLocationId: string;
  vehicleId: string;
  date: string;
  time: string;
  availableSeats: number | null;
  price: string;
  additionalInfo: string;
  acceptsLuggage: boolean;
  allowsMusic: boolean;
  acceptsPets: boolean;
};

export const initialOfferRide: OfferRideDraft = {
  originLocationId: '',
  destinationLocationId: '',
  vehicleId: '',
  date: '',
  time: '',
  availableSeats: null,
  price: '',
  additionalInfo: '',
  acceptsLuggage: true,
  allowsMusic: false,
  acceptsPets: false,
};

export function formatRideDate(value: string) {
  return value
    .replace(/\D/g, '')
    .slice(0, 8)
    .replace(/^(\d{2})(\d)/, '$1/$2')
    .replace(/^(\d{2}\/\d{2})(\d)/, '$1/$2');
}

export function formatRideTime(value: string) {
  return value
    .replace(/\D/g, '')
    .slice(0, 4)
    .replace(/^(\d{2})(\d)/, '$1:$2');
}

export function formatRidePrice(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 7);
  return digits ? (Number(digits) / 100).toFixed(2).replace('.', ',') : '';
}

export function rideDeparture(date: string, time: string): Date | null {
  if (
    !/^\d{2}\/\d{2}\/\d{4}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    return null;
  const [day, month, year] = date.split('/').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const departure = new Date(year, month - 1, day, hour, minute);
  if (
    departure.getFullYear() !== year ||
    departure.getMonth() !== month - 1 ||
    departure.getDate() !== day ||
    departure.getHours() !== hour ||
    departure.getMinutes() !== minute
  )
    return null;
  return departure;
}

export function offerRideInput(draft: OfferRideDraft): CreateRideInput {
  const departure = rideDeparture(draft.date, draft.time);
  if (!departure || !draft.availableSeats)
    throw new Error('Preencha a data, o horário e as vagas.');
  return {
    originLocationId: draft.originLocationId,
    destinationLocationId: draft.destinationLocationId,
    vehicleId: draft.vehicleId,
    departureAt: departure.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    availableSeats: draft.availableSeats,
    pricePerPersonCents: Math.round(
      Number(draft.price.replace(',', '.')) * 100,
    ),
    additionalInfo: draft.additionalInfo.trim() || undefined,
    acceptsLuggage: draft.acceptsLuggage,
    allowsMusic: draft.allowsMusic,
    acceptsPets: draft.acceptsPets,
  };
}
