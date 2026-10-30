// Restrições de digitação; a API continua responsável por validar os dados.
export function vehicleYearInput(value: string, maxLength: number) {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

export function vehiclePlateInput(value: string, maxLength: number) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, maxLength);
}

export function vehicleColorInput(value: string) {
  return value.replace(/[^\p{L}\p{M}\s-]/gu, '');
}

export function vehicleNameInput(value: string) {
  return value.replace(
    /[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}|\p{Regional_Indicator}|\u200D|\uFE0E|\uFE0F|\p{Emoji_Modifier}/gu,
    '',
  );
}
