import { eventBatchSchema, eventSchema } from '@cdp/shared';
import type { FastifyInstance } from 'fastify';
import { ingestEvent, type IngestResult } from '../services/ingest';

export async function eventRoutes(app: FastifyInstance) {
  /** Acepta un evento suelto o { events: [...] } (hasta 500, p. ej. la cola offline de una terminal). */
  app.post('/events', { preHandler: app.authenticateIngest }, async (req, reply) => {
    // `in` lanza TypeError con primitivos (p. ej. un body JSON `5`): se valida que sea objeto antes
    const body = req.body;
    const isBatch = typeof body === 'object' && body !== null && 'events' in body;
    const events = isBatch ? eventBatchSchema.parse(body).events : [eventSchema.parse(body)];

    // QA y las fuentes con llave (simulador) solo generan perfiles sintéticos
    const synthetic = !!req.sourceId || req.user?.role === 'qa';
    const results: IngestResult[] = [];
    for (const event of events) {
      const result = await ingestEvent(app.prisma, event, {
        pepper: app.cfg.IDENTITY_PEPPER,
        sourceId: req.sourceId,
        requestIp: req.ip,
        synthetic,
      });
      results.push(result);
      if (!result.duplicate) {
        app.sse.publish({
          type: 'event',
          data: {
            customerId: result.customerId,
            name: event.name,
            terminalId: event.terminalId,
            at: event.occurredAt,
          },
        });
      }
      for (const loserId of result.merged) {
        app.sse.publish({ type: 'merge', data: { winnerId: result.customerId, loserId, status: 'auto' } });
      }
    }

    return reply.code(202).send({
      accepted: results.filter((r) => !r.duplicate).length,
      duplicates: results.filter((r) => r.duplicate).length,
      results: results.map(({ customerId, created, merged, pendingReview }) => ({
        customerId,
        created,
        merged,
        pendingReview,
      })),
    });
  });
}
