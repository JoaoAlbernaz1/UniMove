import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { DRIVER_LICENSE_MAX_BYTES } from './vehicle-policy';

@Injectable()
export class DriverLicenseService {
  async image(file?: Express.Multer.File) {
    if (!file) return null;
    if (!file.buffer.length || file.buffer.length > DRIVER_LICENSE_MAX_BYTES)
      throw new BadRequestException('A foto da CNH deve ter até 5 MB.');
    try {
      const decoder = sharp(file.buffer, { limitInputPixels: 40000000, failOn: 'warning' });
      const metadata = await decoder.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
        throw new Error('unsupported image');
      // Reencodifica e remove metadados. Não verifica autenticidade, conteúdo ou validade da CNH.
      const image = await decoder
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      return { image: new Uint8Array(image), mimeType: 'image/jpeg', sizeBytes: image.length };
    } catch {
      throw new BadRequestException('Envie uma foto válida da CNH em JPEG, PNG ou WebP.');
    }
  }
}
