// Regressão da busca de caronas: nome de local com acento e partida perto da
// meia-noite. Executar após npm run build. Tudo roda numa transação revertida.
//
// O banco precisa ser local e terminar em _test, como as demais integrações.
require('dotenv/config');
const target = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.endsWith('_test') ||
  process.env.NODE_ENV === 'production'
) {
  console.error('Recusado: a regressão de busca exige banco local com sufixo _test.');
  process.exit(2);
}
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
// O cliente da aplicação, para o teste enxergar a mesma sessão de banco que ela.
const { PrismaService } = require('../dist/src/database/prisma.service.js');
const { RideQueriesService } = require('../dist/src/modules/rides/ride-queries.service.js');
const { OfferRidesService } = require('../dist/src/modules/rides/offer-rides.service.js');
const { SearchRidesDto } = require('../dist/src/modules/rides/search-rides.dto.js');

const prisma = new PrismaService();
const rollback = new Error('ROLLBACK_SEARCH_REGRESSION');
const resultados = [];
const checar = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok });
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
};

async function cenario(tx) {
  const sufixo = randomUUID().slice(0, 8);
  // Nomes com acento, como os do seed: Ceilândia e Guará.
  const origem = await tx.location.create({
    data: { name: `Águas Claras ${sufixo}`, latitude: -15.84, longitude: -48.02 },
  });
  const destino = await tx.location.create({
    data: { name: `Ceilândia Centro ${sufixo}`, latitude: -15.81, longitude: -48.11 },
  });
  const driverId = randomUUID();
  await tx.user.create({
    data: {
      id: driverId,
      fullName: 'Motorista da regressão',
      cpf: String(randomInt(10000000000, 99999999999)),
      institutionalEmail: `${driverId}@ucb.edu.br`,
      passwordHash: 'integration-only',
      profileCompletedAt: new Date(),
      course: 'Engenharia de Software',
      academicVerification: { create: { reportGuid: randomUUID(), status: 'APPROVED' } },
    },
  });
  await tx.driverLicense.create({
    data: { userId: driverId, image: Buffer.from('cnh'), mimeType: 'image/png', sizeBytes: 3 },
  });
  const veiculo = await tx.vehicle.create({
    data: {
      ownerId: driverId,
      brand: 'Fiat',
      model: 'Argo',
      color: 'Prata',
      plate: 'REG' + randomInt(1000, 9999),
      year: 2022,
      passengerCapacity: 4,
    },
  });

  const offers = new OfferRidesService(tx);
  const base = {
    vehicleId: veiculo.id,
    originLocationId: origem.id,
    destinationLocationId: destino.id,
    timezone: 'America/Sao_Paulo',
    availableSeats: 2,
    pricePerPersonCents: 900,
    acceptsLuggage: true,
    allowsMusic: true,
    acceptsPets: false,
  };
  // 08:00 em Brasília, e 22:30 do MESMO dia em Brasília (01:30Z do dia seguinte).
  const manha = await offers.create(driverId, { ...base, departureAt: '2099-12-01T11:00:00Z' });
  const quaseMeiaNoite = await offers.create(driverId, {
    ...base,
    departureAt: '2099-12-02T01:30:00Z',
  });
  const diaSeguinte = await offers.create(driverId, {
    ...base,
    departureAt: '2099-12-02T11:00:00Z',
  });
  return { origem, destino, driverId, manha, quaseMeiaNoite, diaSeguinte, sufixo };
}

async function run() {
  await prisma
    .$transaction(
      async (tx) => {
        const c = await cenario(tx);
        const queries = new RideQueriesService(tx);
        const busca = (valores) =>
          queries.search(Object.assign(new SearchRidesDto(), { limit: 50 }, valores));
        const ids = (resultado) => resultado.items.map((r) => r.id);

        // 1. Acento no termo e no nome gravado.
        const comAcento = await busca({ origin: `Águas Claras ${c.sufixo}` });
        checar(
          'busca encontra o local digitado com acento',
          ids(comAcento).includes(c.manha.id),
          `${comAcento.items.length} resultado(s)`,
        );

        // 2. Termo sem acento tem de achar o nome acentuado.
        const semAcento = await busca({ origin: `aguas claras ${c.sufixo}` });
        checar(
          'busca sem acento encontra o local acentuado',
          ids(semAcento).includes(c.manha.id),
          `${semAcento.items.length} resultado(s)`,
        );

        // 3. Maiúsculas e acento juntos, que é o caso que quebra em locale C.
        const maiusculo = await busca({ origin: `ÁGUAS CLARAS ${c.sufixo}` });
        checar(
          'busca em maiúsculas com acento encontra o local',
          ids(maiusculo).includes(c.manha.id),
          `${maiusculo.items.length} resultado(s)`,
        );

        // 4. O destino usa a mesma regra.
        const porDestino = await busca({ destination: `ceilandia centro ${c.sufixo}` });
        checar(
          'busca por destino sem acento encontra Ceilândia',
          ids(porDestino).includes(c.manha.id),
          `${porDestino.items.length} resultado(s)`,
        );

        if (process.env.INTEGRATION_LOG === '1') {
          const vistas = await tx.$queryRaw`
            SELECT r.id,
                   to_char(r.departure_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') AS em_sp,
                   r.departure_at AS utc, r.departure_at::text AS texto_no_banco, current_setting('TimeZone') AS tz
            FROM rides r WHERE r.driver_id = ${c.driverId}::uuid ORDER BY r.departure_at`;
          for (const v of vistas)
            console.log('DIAG', v.id.slice(0,8), '| no banco:', v.texto_no_banco, '| AT TZ SP:', v.em_sp, '| driver:', v.utc.toISOString(), '| tz sessao:', v.tz);
        }

        // 5. Partida perto da meia-noite: 01:30Z do dia 02 é 22:30 do dia 01 em
        //    Brasília, e precisa aparecer no filtro do dia 01.
        const dia1 = await busca({ origin: `Águas Claras ${c.sufixo}`, date: '01/12/2099' });
        checar(
          'carona de 22:30 em Brasília cai no filtro do dia dela',
          ids(dia1).includes(c.quaseMeiaNoite.id) && ids(dia1).includes(c.manha.id),
          `ids do dia 01: ${ids(dia1).length}`,
        );
        checar(
          'o filtro do dia 01 não traz a carona do dia 02',
          !ids(dia1).includes(c.diaSeguinte.id),
          '',
        );

        // 6. O instante enviado é preservado, não reinterpretado como local.
        const gravada = await tx.ride.findUniqueOrThrow({
          where: { id: c.quaseMeiaNoite.id },
          select: { departureAt: true },
        });
        checar(
          'o instante UTC informado é gravado sem deslocamento',
          gravada.departureAt.toISOString() === '2099-12-02T01:30:00.000Z',
          gravada.departureAt.toISOString(),
        );

        // 6b. A busca autenticada passa o usuário, que é o caminho usado pelo HTTP.
        let erroAutenticado = null;
        const autenticada = await queries
          .search(
            Object.assign(new SearchRidesDto(), { limit: 50, origin: `Águas Claras ${c.sufixo}` }),
            c.driverId,
          )
          .catch((erro) => {
            erroAutenticado = erro;
            return { items: [] };
          });
        if (erroAutenticado && process.env.INTEGRATION_LOG === '1')
          console.log(String(erroAutenticado.stack).slice(0, 400));
        checar(
          'busca autenticada não estoura',
          !erroAutenticado,
          erroAutenticado ? erroAutenticado.message : `${autenticada.items.length} resultado(s)`,
        );

        // 7. Filtro por horário também segue o fuso pedido.
        const porHora = await busca({ origin: `Águas Claras ${c.sufixo}`, time: '22:30' });
        checar(
          'filtro de horário encontra a carona das 22:30 em Brasília',
          ids(porHora).includes(c.quaseMeiaNoite.id),
          `${porHora.items.length} resultado(s)`,
        );

        throw rollback;
      },
      { timeout: 120000 },
    )
    .catch((error) => {
      if (error !== rollback) throw error;
    });

  const restou = await prisma.location.count({ where: { name: { contains: 'Águas Claras ' } } });
  checar('nada ficou no banco depois do teste', restou === 0, `${restou} local(is)`);

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} verificações passaram`);
  await prisma.$disconnect();
  process.exit(falhas.length ? 1 : 0);
}

run().catch(async (error) => {
  console.error('ERRO:', error.message);
  await prisma.$disconnect();
  process.exit(1);
});
