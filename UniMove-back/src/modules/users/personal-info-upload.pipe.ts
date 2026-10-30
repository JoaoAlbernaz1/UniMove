import { BadRequestException, PipeTransform, ValidationPipe } from '@nestjs/common';
import { UpdatePersonalInfoDto } from './personal-info.dto';

export class PersonalInfoUploadPipe implements PipeTransform {
  async transform(value: unknown) {
    if (typeof value !== 'string') throw new BadRequestException('Envie os dados no campo data.');

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException('Os dados devem ser um JSON válido.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new BadRequestException('Informe os dados pessoais.');

    return new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }).transform(parsed, { type: 'body', metatype: UpdatePersonalInfoDto });
  }
}
