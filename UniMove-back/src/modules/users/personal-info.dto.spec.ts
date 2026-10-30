import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePersonalInfoDto } from './personal-info.dto';

describe('Atualização de informações pessoais', () => {
  it('permite atualizar somente a foto sem campos de texto', async () => {
    const dto = plainToInstance(UpdatePersonalInfoDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('normaliza nome e matrícula para o formato UC00000000', async () => {
    const dto = plainToInstance(UpdatePersonalInfoDto, {
      fullName: '  Ana Silva ',
      studentNumber: ' uc12345678 ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.fullName).toBe('Ana Silva');
    expect(dto.studentNumber).toBe('UC12345678');
  });

  it('permite limpar matrícula opcional', async () => {
    const dto = plainToInstance(UpdatePersonalInfoDto, {
      studentNumber: ' ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.studentNumber).toBeNull();
  });

  it.each(['UC1234567', 'UC123456789', 'AB12345678', 'UCabcdefgh'])(
    'rejeita matrícula fora do formato esperado: %s',
    async (studentNumber) => {
      const dto = plainToInstance(UpdatePersonalInfoDto, { studentNumber });
      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it('rejeita nome fora do limite permitido', async () => {
    const dto = plainToInstance(UpdatePersonalInfoDto, {
      fullName: 'A'.repeat(101),
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
