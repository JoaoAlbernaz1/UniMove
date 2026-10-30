import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PROFILE_POLICY } from './profile-policy';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CompleteProfileDto {
  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Length(3, 100)
  fullName?: string;

  @Transform(trim)
  @IsString()
  @Length(PROFILE_POLICY.course.minLength, PROFILE_POLICY.course.maxLength, {
    message: 'Informe seu curso (de 2 a 120 caracteres).',
  })
  course!: string;

  @IsInt()
  @Min(PROFILE_POLICY.semester.min)
  @Max(PROFILE_POLICY.semester.max)
  semester!: number;

  @Transform(trim)
  @IsString()
  @Length(PROFILE_POLICY.bio.minLength, PROFILE_POLICY.bio.maxLength, {
    message: 'Preencha o campo Sobre (até 200 caracteres).',
  })
  bio!: string;

  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((tag: unknown) =>
          typeof tag === 'string' ? tag.trim().replace(/\s+/g, ' ').normalize('NFC') : tag,
        )
      : value,
  )
  @IsArray()
  @ArrayMinSize(PROFILE_POLICY.tags.min, { message: 'Adicione pelo menos 3 tags diferentes.' })
  @ArrayMaxSize(PROFILE_POLICY.tags.max, { message: 'Adicione no máximo 10 tags.' })
  @ArrayUnique(
    (tag: unknown) =>
      typeof tag === 'string' ? tag.normalize('NFKC').toLocaleLowerCase('pt-BR') : tag,
    { message: 'As tags devem ser diferentes.' },
  )
  @IsString({ each: true })
  @Length(PROFILE_POLICY.tags.minLength, PROFILE_POLICY.tags.maxLength, {
    each: true,
    message: 'Cada tag deve ter de 2 a 30 caracteres.',
  })
  tags!: string[];
}
