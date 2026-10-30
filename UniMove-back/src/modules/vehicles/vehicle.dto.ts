import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import {
  MAX_PASSENGER_CAPACITY,
  MIN_PASSENGER_CAPACITY,
  vehicleRegistrationPolicy,
  VEHICLE_FIELD_LIMITS,
  VEHICLE_EMOJI_PATTERN,
} from './vehicle-policy';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const NoVehicleEmoji = () =>
  ValidateBy({
    name: 'noVehicleEmoji',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && !VEHICLE_EMOJI_PATTERN.test(value),
      defaultMessage: () => 'Marca e modelo não podem conter emojis.',
    },
  });

export class CreateVehicleDto {
  @Transform(trim)
  @IsString()
  @Length(1, VEHICLE_FIELD_LIMITS.brand, {
    message: 'Informe a marca do veículo (até 50 caracteres).',
  })
  @NoVehicleEmoji()
  brand!: string;

  @Transform(trim)
  @IsString()
  @Length(1, VEHICLE_FIELD_LIMITS.model, {
    message: 'Informe o modelo do veículo (até 50 caracteres).',
  })
  @NoVehicleEmoji()
  model!: string;

  @Transform(trim)
  @IsString()
  @Length(1, VEHICLE_FIELD_LIMITS.color, {
    message: 'Informe a cor do veículo (até 20 caracteres).',
  })
  @Matches(/^[\p{L}\p{M}\s-]+$/u, { message: 'A cor deve conter apenas letras, espaços ou hífen.' })
  color!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/[-\s]/g, '').toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{3}(?:\d{4}|\d[A-Z]\d{2})$/, {
    message: 'Informe uma placa válida no formato antigo ou Mercosul.',
  })
  plate!: string;

  @IsInt({ message: 'Informe o ano do modelo como número inteiro.' })
  @ValidateBy({
    name: 'vehicleModelYear',
    validator: {
      validate: (value: unknown) => {
        const policy = vehicleRegistrationPolicy();
        return (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= policy.minYear &&
          value <= policy.maxYear
        );
      },
      defaultMessage: () => {
        const policy = vehicleRegistrationPolicy();
        return `O ano do modelo deve estar entre ${policy.minYear} e ${policy.maxYear}.`;
      },
    },
  })
  year!: number;

  @IsInt()
  @Min(MIN_PASSENGER_CAPACITY)
  @Max(MAX_PASSENGER_CAPACITY, {
    message: 'O veículo deve ter de 1 a 6 vagas para passageiros, sem contar o motorista.',
  })
  passengerCapacity!: number;
}

export class UpdateVehicleDto extends PartialType(CreateVehicleDto, { skipNullProperties: false }) {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}
