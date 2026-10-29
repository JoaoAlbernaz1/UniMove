import { IsOptional, IsString, IsTimeZone, Matches, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class SearchRidesDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(150) origin?: string;
  @IsOptional() @IsString() @MaxLength(150) destination?: string;
  @IsOptional()
  @Matches(/^\d{2}\/\d{2}\/\d{4}$/, { message: 'Informe a data no formato dd/mm/aaaa.' })
  date?: string;
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Informe o horário no formato HH:mm.' })
  time?: string;
  @IsTimeZone({ message: 'Informe um fuso horário válido.' }) timezone = 'America/Sao_Paulo';
}
