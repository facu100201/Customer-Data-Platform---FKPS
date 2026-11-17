import { ruleSchema, segmentInputSchema } from '@cdp/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit';
import { previewSegment, refreshSegment, runActivation } from '../services/segments';

const idParam = z.object({ id: z.uuid() });

/**
 * Edición parcial: solo se tocan los campos enviados. La regla se guarda tal como llega (el
 * constructor visual ya la manda en forma canónica); si no viene `definition`, la regla guardada
 * no se reescribe. `.strict()` para que un campo mal escrito no se ignore en silencio.
 */
const segmentPatch = z
  .object({
    name: segmentInputSchema.shape.name.optional(),
    description: z.string().max(500).nullable().optional(),
    definition: ruleSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'No hay campos que actualizar' });

/** Código de error conocido de Prisma (P2002 = llave única repetida, P2025 = registro no encontrado). */
const prismaCode = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : null;

/** Vista previa: solo la regla. Mismo esquema que al guardar, para que coincida con lo que se guardaría. */
const previewInput = z.object({ definition: ruleSchema }).strict();

const activationInput = z.object({
  segmentId: z.uuid(),
  destination: z.enum(['email_mock', 'ads_mock', 'web_personalization', 'webhook']),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export async function segmentRoutes(app: FastifyInstance) {
  app.get('/segments', { preHandler: app.requirePermission('segments:read') }, async () => {
    const segments = await app.prisma.segment.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { memberships: true, activations: true } } },
    });
    // activationCount: al borrar un segmento se borran sus activaciones (ON DELETE CASCADE); la
    // interfaz lo avisa antes de confirmar
    return segments.map(({ _count, ...s }) => ({
      ...s,
      size: _count.memberships,
      activationCount: _count.activations,
    }));
  });

  app.post('/segments', { preHandler: app.requirePermission('segments:write') }, async (req, reply) => {
    const input = segmentInputSchema.parse(req.body);
    let segment;
    try {
      segment = await app.prisma.segment.create({
        data: { ...input, definition: input.definition as object, createdById: req.user.sub },
      });
    } catch (err) {
      if (prismaCode(err) === 'P2002') return reply.code(409).send({ error: 'nombre_duplicado' });
      throw err;
    }
    const size = await refreshSegment(app.prisma, segment.id);
    audit(app.prisma, {
      actorId: req.user.sub,
      action: 'segment.create',
      entity: 'segment',
      entityId: segment.id,
      ip: req.ip,
    });
    return reply.code(201).send({ ...segment, size });
  });

  /**
   * Cuántos perfiles cumplirían una regla, sin guardar nada: no crea segmento, no toca membresías
   * ni deja auditoría. Pide segments:write porque solo sirve mientras se arma un segmento.
   */
  app.post('/segments/preview', { preHandler: app.requirePermission('segments:write') }, async (req) => {
    const { definition } = previewInput.parse(req.body);
    return previewSegment(app.prisma, definition);
  });

  app.patch('/segments/:id', { preHandler: app.requirePermission('segments:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const input = segmentPatch.parse(req.body);

    const previous = await app.prisma.segment.findUnique({ where: { id } });
    if (!previous) return reply.code(404).send({ error: 'no_encontrado' });

    try {
      await app.prisma.segment.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.definition !== undefined && { definition: input.definition as object }),
        },
      });
    } catch (err) {
      if (prismaCode(err) === 'P2002') return reply.code(409).send({ error: 'nombre_duplicado' });
      if (prismaCode(err) === 'P2025') return reply.code(404).send({ error: 'no_encontrado' });
      throw err;
    }

    // Cambiar la regla cambia la membresía; cambiar solo nombre o descripción no.
    const size =
      input.definition !== undefined
        ? await refreshSegment(app.prisma, id)
        : await app.prisma.segmentMembership.count({ where: { segmentId: id } });

    audit(app.prisma, {
      actorId: req.user.sub,
      action: 'segment.update',
      entity: 'segment',
      entityId: id,
      ip: req.ip,
      // La regla anterior queda en la auditoría para poder recuperarla si la edición fue un error
      meta: {
        fields: Object.keys(input),
        ...(input.definition !== undefined && { previousDefinition: previous.definition as object }),
        ...(input.name !== undefined && { previousName: previous.name }),
      },
    });

    const segment = await app.prisma.segment.findUniqueOrThrow({ where: { id } });
    return { ...segment, size };
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

  app.delete('/segments/:id', { preHandler: app.requirePermission('segments:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const previous = await app.prisma.segment.findUnique({ where: { id } });
    if (!previous) return reply.code(404).send({ error: 'no_encontrado' });
    try {
      // borra también membresías y activaciones (ON DELETE CASCADE)
      await app.prisma.segment.delete({ where: { id } });
    } catch (err) {
      if (prismaCode(err) === 'P2025') return reply.code(404).send({ error: 'no_encontrado' });
      throw err;
    }
    audit(app.prisma, {
      actorId: req.user.sub,
      action: 'segment.delete',
      entity: 'segment',
      entityId: id,
      ip: req.ip,
      // lo necesario para volver a crearlo si se borró por error
      meta: {
        name: previous.name,
        description: previous.description,
        definition: previous.definition as object,
      },
    });
    return { ok: true };
  });

  app.get('/activations', { preHandler: app.requirePermission('segments:read') }, async () =>
    app.prisma.activation.findMany({ include: { segment: { select: { name: true } } } }),
  );

  app.post('/activations', { preHandler: app.requirePermission('activations:write') }, async (req, reply) => {
    const input = activationInput.parse(req.body);
    const activation = await app.prisma.activation.create({ data: input });
    audit(app.prisma, {
      actorId: req.user.sub,
      action: 'activation.create',
      entity: 'activation',
      entityId: activation.id,
      ip: req.ip,
    });
    return reply.code(201).send(activation);
  });

  app.post(
    '/activations/:id/run',
    { preHandler: app.requirePermission('activations:write') },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const result = await runActivation(app.prisma, id);
      audit(app.prisma, {
        actorId: req.user.sub,
        action: 'activation.run',
        entity: 'activation',
        entityId: id,
        ip: req.ip,
      });
      return result;
    },
  );

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
    return {
      banner: typeof banner === 'string' ? banner : fallback.banner,
      segment: activation.segment.name,
    };
  });
}
