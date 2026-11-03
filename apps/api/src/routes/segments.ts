import { segmentInputSchema } from '@cdp/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit';
import { refreshSegment, runActivation } from '../services/segments';

const idParam = z.object({ id: z.string().uuid() });

const activationInput = z.object({
  segmentId: z.string().uuid(),
  destination: z.enum(['email_mock', 'ads_mock', 'web_personalization', 'webhook']),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export async function segmentRoutes(app: FastifyInstance) {
  app.get('/segments', { preHandler: app.requirePermission('segments:read') }, async () => {
    const segments = await app.prisma.segment.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { memberships: true } } },
    });
    return segments.map(({ _count, ...s }) => ({ ...s, size: _count.memberships }));
  });

  app.post('/segments', { preHandler: app.requirePermission('segments:write') }, async (req, reply) => {
    const input = segmentInputSchema.parse(req.body);
    const segment = await app.prisma.segment.create({
      data: { ...input, definition: input.definition as object, createdById: req.user.sub },
    });
    const size = await refreshSegment(app.prisma, segment.id);
    audit(app.prisma, { actorId: req.user.sub, action: 'segment.create', entity: 'segment', entityId: segment.id, ip: req.ip });
    return reply.code(201).send({ ...segment, size });
  });

  app.post('/segments/:id/refresh', { preHandler: app.requirePermission('segments:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    return { size: await refreshSegment(app.prisma, id) };
  });

  app.get('/segments/:id/members', { preHandler: app.requirePermission('segments:read') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const rows = await app.prisma.segmentMembership.findMany({
      where: { segmentId: id },
      include: { customer: { select: { id: true, clv: true, churnScore: true, lastSeen: true } } },
      take: 200,
    });
    return rows.map((r) => ({ ...r.customer, enteredAt: r.enteredAt }));
  });

  app.delete('/segments/:id', { preHandler: app.requirePermission('segments:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    await app.prisma.segment.delete({ where: { id } });
    audit(app.prisma, { actorId: req.user.sub, action: 'segment.delete', entity: 'segment', entityId: id, ip: req.ip });
    return { ok: true };
  });

  app.get('/activations', { preHandler: app.requirePermission('segments:read') }, async () =>
    app.prisma.activation.findMany({ include: { segment: { select: { name: true } } } }),
  );

  app.post('/activations', { preHandler: app.requirePermission('activations:write') }, async (req, reply) => {
    const input = activationInput.parse(req.body);
    const activation = await app.prisma.activation.create({ data: input });
    audit(app.prisma, { actorId: req.user.sub, action: 'activation.create', entity: 'activation', entityId: activation.id, ip: req.ip });
    return reply.code(201).send(activation);
  });

  app.post('/activations/:id/run', { preHandler: app.requirePermission('activations:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const result = await runActivation(app.prisma, id);
    audit(app.prisma, { actorId: req.user.sub, action: 'activation.run', entity: 'activation', entityId: id, ip: req.ip });
    return result;
  });

  /**
   * Personalización web: devuelve el banner para un visitante según sus segmentos. Es público dentro
   * de la red ZeroTier y no expone datos del perfil, solo el contenido a mostrar.
   */
  app.get('/personalize/:anonymousId', async (req) => {
    const { anonymousId } = z.object({ anonymousId: z.string().min(1).max(128) }).parse(req.params);
    const event = await app.prisma.event.findFirst({
      where: { anonymousId, customerId: { not: null } },
      select: { customerId: true },
    });
    const fallback = { banner: 'Bienvenido a la tienda FKPS', segment: null };
    if (!event?.customerId) return fallback;

    const activation = await app.prisma.activation.findFirst({
      where: {
        destination: 'web_personalization',
        segment: { memberships: { some: { customerId: event.customerId } } },
      },
      include: { segment: { select: { name: true } } },
    });
    if (!activation) return fallback;
    const banner = (activation.config as Record<string, unknown>).banner;
    return { banner: typeof banner === 'string' ? banner : fallback.banner, segment: activation.segment.name };
  });
}
