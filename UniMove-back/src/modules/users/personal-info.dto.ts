import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, Length } from 'class-validator';

const normalizeName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeStudentNumber = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
};

export class UpdatePersonalInfoDto {
  @Transform(normalizeName)
  @IsOptional()
  @IsString()
  @Length(3, 100)
  fullName?: string;

  @Transform(normalizeStudentNumber)
  @IsOptional()
  @IsString()
  @Matches(/^UC\d{8}$/, {
    message: 'A matrícula deve seguir o formato UC00000000.',
  })
  studentNumber?: string | null;
}
