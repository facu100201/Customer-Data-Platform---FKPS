import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ONLINE_WINDOW_MS = 60_000;

const heartbeatSchema = z.object({
  terminalId: z.string().min(1).max(64),
  label: z.string().max(80).optional(),
});

export async function opsRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    let db = 'ok';
    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return { status: 'ok', db, sseClients: app.sse.size, time: new Date().toISOString() };
  });

  /** Cada terminal (navegador, Electron o simulador) avisa que sigue viva cada 20 s. */
  app.post('/terminals/heartbeat', { preHandler: app.authenticateIngest }, async (req) => {
    const { terminalId, label } = heartbeatSchema.parse(req.body);
    const now = new Date();
    await app.prisma.terminal.upsert({
      where: { id: terminalId },
      create: { id: terminalId, label, ztIp: req.ip, userAgent: req.headers['user-agent'] ?? null, lastHeartbeat: now },
      update: { label, ztIp: req.ip, userAgent: req.headers['user-agent'] ?? null, lastHeartbeat: now },
    });
    app.sse.publish({ type: 'terminal', data: { id: terminalId, at: now.toISOString() } });
    return { ok: true };
  });

  app.get('/terminals', { preHandler: app.requirePermission('terminals:read') }, async () => {
    const rows = await app.prisma.terminal.findMany({ orderBy: { lastHeartbeat: 'desc' } });
    const now = Date.now();
    return rows.map((t) => ({ ...t, online: now - t.lastHeartbeat.getTime() < ONLINE_WINDOW_MS }));
  });

  app.get('/stats/overview', { preHandler: app.requirePermission('dashboard:read') }, async () => {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [customers, events24h, segments, terminalsOnline, pendingMerges, perHour, perCategory, clvDist] =
      await Promise.all([
        app.prisma.customer.count(),
        app.prisma.event.count({ where: { occurredAt: { gte: since } } }),
        app.prisma.segment.count(),
        app.prisma.terminal.count({ where: { lastHeartbeat: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) } } }),
        app.prisma.identityMerge.count({ where: { status: 'pending' } }),
        app.prisma.$queryRaw<{ hour: Date; count: bigint }[]>`
          SELECT date_trunc('hour', occurred_at) AS hour, count(*) AS count
          FROM events WHERE occurred_at >= ${since}
          GROUP BY 1 ORDER BY 1`,
        app.prisma.event.groupBy({ by: ['category'], _count: true, where: { occurredAt: { gte: since } } }),
        app.prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
          SELECT CASE
                   WHEN clv IS NULL OR clv = 0 THEN '0'
                   WHEN clv < 100 THEN '1-99'
                   WHEN clv < 500 THEN '100-499'
                   WHEN clv < 2000 THEN '500-1999'
                   ELSE '2000+'
                 END AS bucket, count(*) AS count
          FROM customers GROUP BY 1`,
      ]);
    return {
      customers,
      events24h,
      segments,
      terminalsOnline,
      pendingMerges,
      eventsPerHour: perHour.map((r) => ({ hour: r.hour.toISOString(), count: Number(r.count) })),
      eventsPerCategory: perCategory.map((r) => ({ category: r.category, count: r._count })),
      clvDistribution: clvDist.map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
    };
  });

  /** Canal en vivo para el dashboard (Server-Sent Events). Apache lo pasa con flushpackets=on. */
  app.get('/stream', { preHandler: app.authenticate }, async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': conectado\n\n');
    const remove = app.sse.add(reply.raw, req.user.role);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      remove();
    });
  });
}
