import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // A sessão fica em UTC, não no fuso do servidor de banco. Sem isto o
    // instante é gravado deslocado quando o PostgreSQL roda em outro fuso: o
    // driver manda o horário sem deslocamento, o servidor o interpreta no
    // fuso dele e `departure_at` fica como 11:00-03 onde deveria estar
    // 11:00+00. A leitura desfaz a diferença e esconde o erro da aplicação,
    // mas todo SQL que usa `AT TIME ZONE` — os filtros de data e de horário
    // da busca — passa a trabalhar sobre o valor errado. A conversão para o
    // fuso de quem busca continua explícita em cada consulta.
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
      options: '-c timezone=UTC',
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
