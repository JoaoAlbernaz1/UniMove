import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';

export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class ProfilePhotoService {
  async image(file?: Express.Multer.File) {
    if (!file) return null;
    if (!file.buffer.length || file.buffer.length > PROFILE_PHOTO_MAX_BYTES)
      throw new BadRequestException('A foto de perfil deve ter até 5 MB.');

    try {
      const decoder = sharp(file.buffer, {
        limitInputPixels: 40000000,
        failOn: 'warning',
      });
      const metadata = await decoder.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
        throw new Error('unsupported image');
      const image = await decoder
        .rotate()
        .resize({ width: 1024, height: 1024, fit: 'cover', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      return {
        image: new Uint8Array(image),
        mimeType: 'image/jpeg',
        sizeBytes: image.length,
      };
    } catch {
      throw new BadRequestException('Envie uma foto de perfil válida em JPEG, PNG ou WebP.');
    }
  }
}
