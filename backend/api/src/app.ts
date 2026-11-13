import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config';
import { setupAuth } from './plugins/auth';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { customerRoutes } from './routes/customers';
import { eventRoutes } from './routes/events';
import { opsRoutes } from './routes/ops';
import { segmentRoutes } from './routes/segments';
import { SseHub } from './services/sse';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    cfg: Config;
    sse: SseHub;
  }
}

export async function buildApp(deps: {
  cfg: Config;
  prisma: PrismaClient;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    // Apache en el mismo equipo hace de proxy: confiamos en su X-Forwarded-For para req.ip
    trustProxy: ['127.0.0.1', '::1'],
    bodyLimit: 1_048_576,
  });

  app.decorate('prisma', deps.prisma);
  app.decorate('cfg', deps.cfg);
  app.decorate('sse', new SseHub());

  // Holgado a propósito: el simulador manda 20+ terminales desde una sola IP. El login tiene su propio límite.
  await app.register(rateLimit, { global: true, max: 5000, timeWindow: '1 minute' });
  await setupAuth(app, deps.cfg);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validacion', issues: err.issues });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply
        .code(err.statusCode)
        .send({ error: err.code ?? 'peticion_invalida', message: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'error_interno' });
  });

  await app.register(
    async (api) => {
      await api.register(opsRoutes);
      await api.register(authRoutes);
      await api.register(eventRoutes);
      await api.register(customerRoutes);
      await api.register(segmentRoutes);
      await api.register(adminRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
