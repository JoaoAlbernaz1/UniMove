import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteProfileDto } from './profile.dto';

describe('Perfil obrigatório', () => {
  const input = {
    course: 'Engenharia de Software',
    semester: 3,
    bio: 'Gosto de compartilhar caronas.',
    tags: ['Pontual', 'Música ambiente', 'Aceita pets'],
  };

  it('normaliza os textos e preserva os dados reais do usuário', async () => {
    const dto = plainToInstance(CompleteProfileDto, {
      ...input,
      course: '  Engenharia de Software ',
      tags: [' Pontual ', 'Música   ambiente', 'Aceita pets'],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.course).toBe(input.course);
    expect(dto.tags).toEqual(input.tags);
  });

  it.each([
    { course: '' },
    { course: '  ' },
    { course: null },
    { semester: 0 },
    { semester: 1.5 },
    { semester: '3' },
    { semester: null },
    { bio: '  ' },
    { bio: 'x'.repeat(201) },
    { tags: [] },
    { tags: ['Pontual', 'Aceita pets'] },
    { tags: ['Pontual', ' pontual ', 'Música'] },
    { tags: ['Música ambiente', 'Música   ambiente', 'Pets'] },
    { tags: ['Pontual', '', 'Pets'] },
    { tags: [123, 'Música', 'Pets'] },
    { tags: null },
  ])('rejeita perfil incompleto ou inválido: %p', async (change) => {
    expect(
      (await validate(plainToInstance(CompleteProfileDto, { ...input, ...change }))).length,
    ).toBeGreaterThan(0);
  });
});
