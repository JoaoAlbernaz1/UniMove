import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { DriverLicenseService } from './driver-license.service';

describe('Foto de CNH sem análise documental', () => {
  const service = new DriverLicenseService();
  const upload = (buffer: Buffer) =>
    ({ buffer, mimetype: 'image/jpeg', originalname: 'cnh.jpg' }) as Express.Multer.File;

  it('processa a imagem e remove metadados sem exigir aprovação', async () => {
    const source = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: '#ffffff' },
    })
      .png()
      .withMetadata()
      .toBuffer();
    const result = await service.image(upload(source));
    expect(result?.mimeType).toBe('image/jpeg');
    expect(result?.sizeBytes).toBeGreaterThan(0);
    const metadata = await sharp(Buffer.from(result!.image)).metadata();
    expect(metadata.width).toBe(2000);
    expect(metadata.exif).toBeUndefined();
  });

  it('não aceita arquivo de texto disfarçado de foto', async () => {
    await expect(service.image(upload(Buffer.from('documento')))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('limita o tamanho do upload', async () => {
    await expect(service.image(upload(Buffer.alloc(5 * 1024 * 1024 + 1)))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
