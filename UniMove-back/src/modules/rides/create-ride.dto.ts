import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_PASSENGER_CAPACITY } from '../vehicles/vehicle-policy';

export class CreateRideDto {
  @IsUUID() vehicleId!: string;
  @IsUUID() originLocationId!: string;
  @IsUUID() destinationLocationId!: string;
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  departureAt!: string;
  @IsTimeZone() timezone!: string;
  @IsInt() @Min(1) @Max(MAX_PASSENGER_CAPACITY) availableSeats!: number;
  @IsInt() @Min(0) @Max(1000000) pricePerPersonCents!: number;
  @IsOptional() @IsString() @MaxLength(1000) additionalInfo?: string;
  @IsBoolean() acceptsLuggage!: boolean;
  @IsBoolean() allowsMusic!: boolean;
  @IsBoolean() acceptsPets!: boolean;
}
