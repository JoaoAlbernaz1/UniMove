import { BadRequestException, PipeTransform, Type, ValidationPipe } from '@nestjs/common';

// O multipart transporta o DTO em um campo JSON, preservando os tipos numéricos.
export class VehicleUploadPipe implements PipeTransform {
  constructor(private readonly dtoType: Type<unknown>) {}

  async transform(value: unknown) {
    if (typeof value !== 'string')
      throw new BadRequestException('Envie os dados do veículo no campo data.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException('Os dados do veículo devem ser um JSON válido.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new BadRequestException('Informe os dados do veículo.');
    return new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }).transform(parsed, { type: 'body', metatype: this.dtoType });
  }
}
