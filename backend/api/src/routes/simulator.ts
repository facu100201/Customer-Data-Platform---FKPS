import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { scope } from './customers';

const DAY = 86_400_000;

/** Únicos campos de `aggregates` que usan computeClv y computeChurn. No hay PII en ninguno. */
export const SIMULATOR_FIELDS = [
  'avg_order_value',
  'orders_30d',
  'orders_total',
  'days_since_last_event',
  'sessions_30d',
  'support_tickets_30d',
  'cart_abandoned_30d',
] as const;

type SimulatorField = (typeof SIMULATOR_FIELDS)[number];

/** Cursor "<updatedAt ISO>_<id>": la posición del último perfil que recibió el cliente. */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([0-9a-f-]{36})$/;

const query = z.object({
  cursor: z
    .string()
    .regex(CURSOR, 'cursor inválido')
    .transform((c) => {
      const [, at = '', id = ''] = CURSOR.exec(c) ?? [];
      return { at: new Date(at), id };
    })
    .refine((c) => !Number.isNaN(c.at.getTime()) && z.uuid().safeParse(c.id).success, 'cursor inválido')
    .optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

const pickFields = (aggregates: unknown): Record<SimulatorField, number | null> => {
  const src = (aggregates ?? {}) as Record<string, unknown>;
  const out = {} as Record<SimulatorField, number | null>;
  for (const f of SIMULATOR_FIELDS) {
    const v = src[f];
    out[f] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
};

export async function simulatorRoutes(app: FastifyInstance) {
  /**
   * Datos para el simulador de escenarios: por perfil, solo los agregados que usan CLV y churn y la
   * antigüedad con la que la API calculó su CLV. Sin rasgos ni identificadores.
   *
   * Sin `cursor` devuelve desde el principio. Con el `nextCursor` de una respuesta anterior devuelve
   * solo los perfiles nuevos o recalculados desde entonces (orden por updatedAt, id). QA solo ve
   * perfiles sintéticos, igual que en /customers.
   */
  app.get('/simulator/customers', { preHandler: app.requirePermission('simulator:run') }, async (req) => {
    const q = query.parse(req.query);
    const base = scope(req);
    const where: Prisma.CustomerWhereInput = q.cursor
      ? {
          ...base,
          OR: [{ updatedAt: { gt: q.cursor.at } }, { updatedAt: q.cursor.at, id: { gt: q.cursor.id } }],
        }
      : base;

    const [total, rows] = await Promise.all([
      app.prisma.customer.count({ where: base }),
      app.prisma.customer.findMany({
        where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: q.limit + 1,
        select: { id: true, firstSeen: true, updatedAt: true, aggregates: true },
      }),
    ]);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page.at(-1);
    const nextCursor = last
      ? `${last.updatedAt.toISOString()}_${last.id}`
      : q.cursor
        ? `${q.cursor.at.toISOString()}_${q.cursor.id}`
        : null;

    return {
      /** Perfiles visibles para este rol (sirve para detectar perfiles fusionados o borrados). */
      total,
      hasMore,
      nextCursor,
      items: page.map((c) => ({
        id: c.id,
        updatedAt: c.updatedAt.toISOString(),
        // igual que recomputeProfile: días entre el primer evento y el último recálculo
        tenureDays: Math.max(1, (c.updatedAt.getTime() - c.firstSeen.getTime()) / DAY),
        aggregates: pickFields(c.aggregates),
      })),
    };
  });
}
