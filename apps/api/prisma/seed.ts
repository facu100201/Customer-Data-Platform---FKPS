/**
 * Crea los 4 usuarios iniciales, la fuente del simulador y un segmento de ejemplo.
 * Es idempotente: se puede correr en cada despliegue.
 */
import { hash } from '@node-rs/argon2';
import type { Role } from '@cdp/shared';
import { PrismaClient } from '@prisma/client';
import { hashApiKey } from '../src/lib/crypto';

try {
  process.loadEnvFile();
} catch {
  // variables ya en el entorno
}

const prisma = new PrismaClient();

const USERS: { role: Role; emailVar: string; passwordVar: string }[] = [
  { role: 'usuario', emailVar: 'SEED_USUARIO_EMAIL', passwordVar: 'SEED_USUARIO_PASSWORD' },
  { role: 'admin', emailVar: 'SEED_ADMIN_EMAIL', passwordVar: 'SEED_ADMIN_PASSWORD' },
  { role: 'superusuario', emailVar: 'SEED_SUPER_EMAIL', passwordVar: 'SEED_SUPER_PASSWORD' },
  { role: 'qa', emailVar: 'SEED_QA_EMAIL', passwordVar: 'SEED_QA_PASSWORD' },
];

async function main() {
  for (const { role, emailVar, passwordVar } of USERS) {
    const email = process.env[emailVar]?.toLowerCase();
    const password = process.env[passwordVar];
    if (!email || !password || password.length < 12) {
      throw new Error(`Falta ${emailVar} o ${passwordVar} (mínimo 12 caracteres) en .env`);
    }
    // no se sobreescribe la contraseña si el usuario ya existe: se cambia desde la app
    await prisma.appUser.upsert({
      where: { email },
      create: { email, role, passwordHash: await hash(password) },
      update: { role },
    });
    console.log(`usuario ${role}: ${email}`);
  }

  const simKey = process.env.SIM_SOURCE_KEY;
  if (simKey) {
    await prisma.source.upsert({
      where: { name: 'simulador' },
      create: { name: 'simulador', kind: 'simulator', apiKeyHash: hashApiKey(simKey) },
      update: { apiKeyHash: hashApiKey(simKey), active: true },
    });
    console.log('fuente simulador registrada');
  }

  const admin = await prisma.appUser.findFirst({ where: { role: 'admin' } });
  const segment = await prisma.segment.upsert({
    where: { name: 'Gastadores inactivos en app' },
    create: {
      name: 'Gastadores inactivos en app',
      description: 'Gastaron más de $100 en 30 días pero no abren la app hace 14 días o más',
      definition: {
        all: [
          { field: 'spend_30d', op: 'gt', value: 100 },
          { field: 'days_since_app_open', op: 'gte', value: 14 },
        ],
      },
      createdById: admin?.id,
    },
    update: {},
  });
  const hasActivation = await prisma.activation.count({ where: { segmentId: segment.id } });
  if (!hasActivation) {
    await prisma.activation.create({
      data: {
        segmentId: segment.id,
        destination: 'web_personalization',
        config: { banner: 'Te extrañamos: 15% de descuento si vuelves a la app' },
      },
    });
  }
  console.log('segmento de ejemplo listo');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
