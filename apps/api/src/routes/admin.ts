import { ROLES } from '@cdp/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit';

const alertInput = z.object({
  source: z.string().max(64),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  category: z.string().max(64),
  summary: z.string().max(1000),
  excerpt: z.string().max(4000),
  model: z.string().max(64),
});

export async function adminRoutes(app: FastifyInstance) {
  // --- Seguridad (Sentinel + Ollama) ---
  app.get('/security/alerts', { preHandler: app.requirePermission('security:read') }, async () =>
    app.prisma.securityAlert.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
  );

  app.post('/security/alerts', { preHandler: app.authenticateSentinel }, async (req, reply) => {
    const alert = await app.prisma.securityAlert.create({ data: alertInput.parse(req.body) });
    app.sse.publish({ type: 'alert', data: { id: alert.id, severity: alert.severity, summary: alert.summary } });
    return reply.code(201).send({ id: alert.id });
  });

  app.post('/security/alerts/:id/ack', { preHandler: app.requirePermission('security:manage') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.prisma.securityAlert.update({ where: { id }, data: { acknowledgedBy: req.user.sub } });
    audit(app.prisma, { actorId: req.user.sub, action: 'alert.ack', entity: 'security_alert', entityId: id, ip: req.ip });
    return { ok: true };
  });

  /** Señales que el Sentinel no puede leer de los logs de Apache: logins fallidos de la aplicación. */
  app.get('/security/signals', { preHandler: app.authenticateSentinel }, async (req) => {
    const { minutes } = z.object({ minutes: z.coerce.number().int().min(1).max(1440).default(5) }).parse(req.query);
    const since = new Date(Date.now() - minutes * 60_000);
    const failed = await app.prisma.auditLog.groupBy({
      by: ['ip'],
      where: { action: 'auth.login_failed', at: { gte: since } },
      _count: true,
    });
    return { since: since.toISOString(), failedLogins: failed.map((f) => ({ ip: f.ip, count: f._count })) };
  });

  // --- Auditoría ---
  app.get('/audit', { preHandler: app.requirePermission('audit:read') }, async (req) => {
    const { action } = z.object({ action: z.string().max(64).optional() }).parse(req.query);
    const rows = await app.prisma.auditLog.findMany({
      where: action ? { action } : {},
      orderBy: { at: 'desc' },
      take: 200,
      include: { actor: { select: { email: true, role: true } } },
    });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  });

  // --- Usuarios y roles ---
  app.get('/users', { preHandler: app.requirePermission('users:manage') }, async () =>
    app.prisma.appUser.findMany({
      select: { id: true, email: true, role: true, active: true, lastLogin: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

  app.patch('/users/:id', { preHandler: app.requirePermission('users:manage') }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional() }).parse(req.body);
    const target = await app.prisma.appUser.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'no_encontrado' });

    // admin solo administra cuentas "usuario"; cambiar roles requiere superusuario
    const isSuper = req.user.role === 'superusuario';
    if (!isSuper && (input.role !== undefined || target.role !== 'usuario')) {
      return reply.code(403).send({ error: 'sin_permiso', permiso: 'roles:manage' });
    }
    if (id === req.user.sub) return reply.code(409).send({ error: 'no_puedes_modificarte' });

    const user = await app.prisma.appUser.update({
      where: { id },
      data: input,
      select: { id: true, email: true, role: true, active: true },
    });
    audit(app.prisma, { actorId: req.user.sub, action: 'user.update', entity: 'app_user', entityId: id, ip: req.ip, meta: input });
    return user;
  });
}
