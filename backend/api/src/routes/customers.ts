import { can } from '@cdp/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit';
import { mergeCustomers, recomputeProfile } from '../services/profiles';

const PII_TRAITS = ['name', 'first_name', 'last_name', 'email', 'phone', 'address', 'birthdate'];

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['lastSeen', 'clv', 'churnScore']).default('lastSeen'),
});

function redactTraits(req: FastifyRequest, traits: unknown) {
  if (can(req.user.role, 'customers:read_pii')) return traits;
  const copy = { ...(traits as Record<string, unknown>) };
  for (const key of PII_TRAITS) if (key in copy) copy[key] = '***';
  return copy;
}

/** QA trabaja solo sobre perfiles sintéticos (simulador y pruebas). */
const scope = (req: FastifyRequest): Prisma.CustomerWhereInput =>
  req.user.role === 'qa' ? { synthetic: true } : {};

export async function customerRoutes(app: FastifyInstance) {
  app.get('/customers', { preHandler: app.requirePermission('customers:read') }, async (req) => {
    const q = listQuery.parse(req.query);
    const where = scope(req);
    const [total, rows] = await Promise.all([
      app.prisma.customer.count({ where }),
      app.prisma.customer.findMany({
        where,
        // lastSeen es obligatorio y Prisma rechaza `nulls` en columnas NOT NULL
        orderBy: q.sort === 'lastSeen' ? { lastSeen: 'desc' } : { [q.sort]: { sort: 'desc', nulls: 'last' } },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { identities: { select: { type: true, valueMasked: true } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((c) => ({ ...c, traits: redactTraits(req, c.traits) })),
    };
  });

  app.get('/customers/:id', { preHandler: app.requirePermission('customers:read') }, async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const customer = await app.prisma.customer.findFirst({
      where: { id, ...scope(req) },
      include: {
        identities: {
          select: { type: true, valueMasked: true, confidence: true, source: true, firstSeen: true },
        },
        events: { orderBy: { occurredAt: 'desc' }, take: 100 },
        memberships: { include: { segment: { select: { id: true, name: true } } } },
      },
    });
    if (!customer) return reply.code(404).send({ error: 'no_encontrado' });
    if (can(req.user.role, 'customers:read_pii')) {
      audit(app.prisma, {
        actorId: req.user.sub,
        action: 'customer.view_pii',
        entity: 'customer',
        entityId: id,
        ip: req.ip,
      });
    }
    return {
      ...customer,
      traits: redactTraits(req, customer.traits),
      events: customer.events.map((e) => ({ ...e, id: e.id.toString() })),
    };
  });

  app.get('/merges', { preHandler: app.requirePermission('merges:review') }, async (req) => {
    const { status } = z
      .object({ status: z.enum(['auto', 'pending', 'approved', 'rejected']).default('pending') })
      .parse(req.query);
    return app.prisma.identityMerge.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.post(
    '/merges/:id/:decision',
    { preHandler: app.requirePermission('merges:review') },
    async (req, reply) => {
      const { id, decision } = z
        .object({ id: z.uuid(), decision: z.enum(['approve', 'reject']) })
        .parse(req.params);
      const merge = await app.prisma.identityMerge.findUnique({ where: { id } });
      if (!merge || merge.status !== 'pending') return reply.code(409).send({ error: 'no_pendiente' });

      if (decision === 'reject') {
        await app.prisma.identityMerge.update({
          where: { id },
          data: { status: 'rejected', decidedBy: req.user.sub, decidedAt: new Date() },
        });
      } else {
        const both = await app.prisma.customer.count({
          where: { id: { in: [merge.winnerId, merge.loserId] } },
        });
        if (both !== 2) return reply.code(409).send({ error: 'perfil_ya_no_existe' });
        await app.prisma.$transaction((tx) =>
          mergeCustomers(tx, {
            winnerId: merge.winnerId,
            loserId: merge.loserId,
            rule: merge.rule,
            score: Number(merge.score),
            reasons: merge.reasons as string[],
            status: 'approved',
            decidedBy: req.user.sub,
            mergeId: id,
          }),
        );
        await recomputeProfile(app.prisma, merge.winnerId);
        app.sse.publish({
          type: 'merge',
          data: { winnerId: merge.winnerId, loserId: merge.loserId, status: 'approved' },
        });
      }
      audit(app.prisma, {
        actorId: req.user.sub,
        action: `merge.${decision}`,
        entity: 'identity_merge',
        entityId: id,
        ip: req.ip,
      });
      return { ok: true };
    },
  );
}
