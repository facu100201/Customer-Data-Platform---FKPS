import { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import { loadConfig } from './config';

const cfg = loadConfig();
const prisma = new PrismaClient();
const app = await buildApp({ cfg, prisma, logger: true });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'cerrando API');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: cfg.HOST, port: cfg.PORT });
