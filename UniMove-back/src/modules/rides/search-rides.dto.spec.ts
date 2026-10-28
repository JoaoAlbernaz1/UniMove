import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchRidesDto } from './search-rides.dto';

describe('Contrato dos filtros de busca', () => {
  it('aceita filtros independentes e converte a paginação', async () => {
    const dto = plainToInstance(SearchRidesDto, {
      date: '01/12/2099',
      time: '08:00',
      page: '2',
      limit: '10',
      timezone: 'America/Sao_Paulo',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
  });
  it.each([
    { page: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { time: '24:00' },
    { time: '08:' },
    { date: '01/12' },
    { timezone: 'inválido' },
  ])('recusa filtro ou paginação inválida: %p', async (value) => {
    expect(await validate(plainToInstance(SearchRidesDto, value))).not.toHaveLength(0);
  });
});
