export const MIN_PASSENGER_CAPACITY = 1;
export const MAX_PASSENGER_CAPACITY = 6;
export const MIN_VEHICLE_YEAR = 1990;
export const DRIVER_LICENSE_MAX_BYTES = 5 * 1024 * 1024;
export const VEHICLE_FIELD_LIMITS = { brand: 50, model: 50, color: 20, plate: 7, year: 4 };
export const VEHICLE_EMOJI_PATTERN =
  /[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}|\p{Regional_Indicator}|\u200D|\uFE0E|\uFE0F|\p{Emoji_Modifier}/u;

// Calculado a cada consulta/validação, inclusive se o servidor atravessar a virada do ano.
export function vehicleRegistrationPolicy() {
  const currentYear = Number(
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    ),
  );
  return {
    minYear: MIN_VEHICLE_YEAR,
    maxYear: currentYear + 1,
    minPassengerCapacity: MIN_PASSENGER_CAPACITY,
    maxPassengerCapacity: MAX_PASSENGER_CAPACITY,
    fieldMaxLengths: VEHICLE_FIELD_LIMITS,
    driverLicense: {
      required: true,
      maxBytes: DRIVER_LICENSE_MAX_BYTES,
      formats: ['JPEG', 'PNG', 'WebP'],
    },
  };
}
