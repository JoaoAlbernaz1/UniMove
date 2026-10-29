import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';
import { RoleName, UserStatus } from '../src/generated/prisma/enums';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const locations = [
  { name: 'Águas Claras', latitude: -15.8371, longitude: -48.028 },
  { name: 'Ceilândia', latitude: -15.8171, longitude: -48.1048 },
  { name: 'Samambaia', latitude: -15.8768, longitude: -48.0889 },
  { name: 'Taguatinga', latitude: -15.8328, longitude: -48.0558 },
  { name: 'Vicente Pires', latitude: -15.8011, longitude: -48.0207 },
  { name: 'Guará', latitude: -15.8245, longitude: -47.9781 },
  { name: 'Riacho Fundo', latitude: -15.8842, longitude: -48.0159 },
  { name: 'Recanto das Emas', latitude: -15.9048, longitude: -48.0705 },
  { name: 'UCB Taguatinga', latitude: -15.8339, longitude: -48.0621 },
];

async function seed() {
  for (const name of Object.values(RoleName))
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  for (const location of locations)
    await prisma.location.upsert({
      where: { name: location.name },
      update: {
        active: true,
        latitude: location.latitude,
        longitude: location.longitude,
      },
      create: {
        name: location.name,
        type: location.name.startsWith('UCB') ? 'CAMPUS' : 'REGION',
        latitude: location.latitude,
        longitude: location.longitude,
      },
    });
  if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } });
    const admin = await prisma.user.upsert({
      where: { institutionalEmail: process.env.SEED_ADMIN_EMAIL },
      update: {},
      create: {
        fullName: 'Administrador UniMove',
        cpf: '00000000191',
        institutionalEmail: process.env.SEED_ADMIN_EMAIL,
        passwordHash: await argon2.hash(process.env.SEED_ADMIN_PASSWORD),
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: role.id } },
      update: {},
      create: { userId: admin.id, roleId: role.id },
    });
  }
}
void seed().finally(() => prisma.$disconnect());
