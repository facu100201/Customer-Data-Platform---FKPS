import type { Role } from '@cdp/shared';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { SESSION_COOKIE } from '../plugins/auth';

// Sin base de datos: el stub guarda los filtros que recibe Prisma y devuelve filas fijas.
type Row = { id: string; firstSeen: Date; updatedAt: Date; aggregates: unknown };
type Args = { where?: Record<string, unknown>; take?: number };

let rows: Row[] = [];
const calls: { count: Args[]; findMany: Args[] } = { count: [], findMany: [] };
const prismaStub = {
  customer: {
    count: async (args: Args) => {
      calls.count.push(args);
      return 42;
    },
    findMany: async (args: Args) => {
      calls.findMany.push(args);
      return rows.slice(0, args.take);
    },
  },
} as unknown as PrismaClient;

const cfg = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://x:y@127.0.0.1:5432/test',
  JWT_SECRET: 'x'.repeat(40),
  IDENTITY_PEPPER: 'p'.repeat(20),
});

let app: Awaited<ReturnType<typeof buildApp>>;
const cookieFor = (role: Role) =>
  `${SESSION_COOKIE}=${app.jwt.sign({ sub: '7d9f2a4e-1111-4c2b-9a3e-000000000001', email: `${role}@fkps.local`, role })}`;
const get = (url: string, role?: Role) =>
  app.inject({ method: 'GET', url, headers: role ? { cookie: cookieFor(role) } : {} });

const ID_A = '0b6f0a52-6f1e-4a57-9d3c-2b4e5f6a7b01';
const ID_B = '0b6f0a52-6f1e-4a57-9d3c-2b4e5f6a7b02';
const ID_C = '0b6f0a52-6f1e-4a57-9d3c-2b4e5f6a7b03';
const row = (id: string, updatedAt: string, aggregates: unknown = {}): Row => ({
  id,
  firstSeen: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date(updatedAt),
  aggregates,
});

beforeAll(async () => {
  app = await buildApp({ cfg, prisma: prismaStub });
});
afterAll(() => app.close());
beforeEach(() => {
  rows = [];
  calls.count = [];
  calls.findMany = [];
});

describe('GET /api/simulator/customers · permisos', () => {
  it('pide sesión', async () => {
    expect((await get('/api/simulator/customers')).statusCode).toBe(401);
  });

  it('rechaza a quien no tiene simulator:run (usuario)', async () => {
    const res = await get('/api/simulator/customers', 'usuario');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ permiso: 'simulator:run' });
    expect(calls.findMany).toHaveLength(0);
  });

  it.each<Role>(['qa', 'admin', 'superusuario'])('%s tiene acceso', async (role) => {
    expect((await get('/api/simulator/customers', role)).statusCode).toBe(200);
  });

  it('QA solo consulta perfiles sintéticos, también en el conteo y con cursor', async () => {
    await get('/api/simulator/customers', 'qa');
    await get(`/api/simulator/customers?cursor=2026-11-01T10:00:00.000Z_${ID_A}`, 'qa');
    for (const args of [...calls.count, ...calls.findMany]) {
      expect(args.where).toMatchObject({ synthetic: true });
    }
  });

  it('admin ve todos los perfiles (sin filtro de sintéticos)', async () => {
    await get('/api/simulator/customers', 'admin');
    expect(calls.findMany[0]?.where).not.toHaveProperty('synthetic');
    expect(calls.count[0]?.where).not.toHaveProperty('synthetic');
  });
});

describe('GET /api/simulator/customers · respuesta', () => {
  it('devuelve solo los campos que usa el modelo, sin rasgos ni PII', async () => {
    rows = [
      row(ID_A, '2026-10-31T00:00:00.000Z', {
        avg_order_value: 50,
        orders_30d: 2,
        orders_total: 3,
        days_since_last_event: 1,
        sessions_30d: 4,
        support_tickets_30d: 0,
        cart_abandoned_30d: 1,
        spend_total: 150,
        email: 'ana@example.com',
      }),
    ];
    const res = await get('/api/simulator/customers', 'admin');
    expect(res.statusCode).toBe(200);
    const item = res.json().items[0];
    expect(Object.keys(item).sort()).toEqual(['aggregates', 'id', 'tenureDays', 'updatedAt']);
    expect(item.aggregates).toEqual({
      avg_order_value: 50,
      orders_30d: 2,
      orders_total: 3,
      days_since_last_event: 1,
      sessions_30d: 4,
      support_tickets_30d: 0,
      cart_abandoned_30d: 1,
    });
    expect(res.body).not.toContain('ana@example.com');
    expect(calls.findMany[0]).toMatchObject({
      select: { id: true, firstSeen: true, updatedAt: true, aggregates: true },
    });
  });

  it('calcula la antigüedad como recomputeProfile (mínimo 1 día) y limpia valores no numéricos', async () => {
    rows = [
      row(ID_A, '2026-10-31T00:00:00.000Z', { orders_30d: 'x', sessions_30d: null }),
      row(ID_B, '2026-10-01T06:00:00.000Z', null),
    ];
    const items = (await get('/api/simulator/customers', 'admin')).json().items;
    expect(items[0].tenureDays).toBe(30);
    expect(items[0].aggregates.orders_30d).toBeNull();
    expect(items[0].aggregates.sessions_30d).toBeNull();
    expect(items[1].tenureDays).toBe(1);
    expect(items[1].aggregates.avg_order_value).toBeNull();
  });

  it('pagina con limit y entrega el cursor del último perfil', async () => {
    rows = [
      row(ID_A, '2026-11-01T10:00:00.000Z'),
      row(ID_B, '2026-11-01T10:00:00.000Z'),
      row(ID_C, '2026-11-02T10:00:00.000Z'),
    ];
    const body = (await get('/api/simulator/customers?limit=2', 'admin')).json();
    expect(calls.findMany[0]).toMatchObject({ take: 3, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }] });
    expect(body).toMatchObject({ total: 42, hasMore: true, nextCursor: `2026-11-01T10:00:00.000Z_${ID_B}` });
    expect(body.items).toHaveLength(2);
  });

  it('con cursor pide solo lo posterior, sin perder empates de updatedAt', async () => {
    await get(`/api/simulator/customers?cursor=2026-11-01T10:00:00.000Z_${ID_A}`, 'admin');
    const at = new Date('2026-11-01T10:00:00.000Z');
    expect(calls.findMany[0]?.where).toEqual({
      OR: [{ updatedAt: { gt: at } }, { updatedAt: at, id: { gt: ID_A } }],
    });
    // el conteo total no se filtra por cursor
    expect(calls.count[0]?.where).toEqual({});
  });

  it('sin perfiles nuevos conserva el cursor recibido', async () => {
    const cursor = `2026-11-01T10:00:00.000Z_${ID_A}`;
    const body = (await get(`/api/simulator/customers?cursor=${cursor}`, 'admin')).json();
    expect(body).toMatchObject({ items: [], hasMore: false, nextCursor: cursor });
  });

  it('sin cursor y sin perfiles, nextCursor es null', async () => {
    expect((await get('/api/simulator/customers', 'admin')).json().nextCursor).toBeNull();
  });

  it.each([
    'cursor=ayer',
    `cursor=2026-11-01_${ID_A}`,
    'cursor=2026-11-01T10:00:00.000Z_no-es-un-uuid-no-es-un-uuid-no-es-un',
    'cursor=2026-13-45T10:00:00.000Z_' + ID_A,
    'limit=0',
    'limit=5001',
  ])('responde 400 con %s', async (qs) => {
    const res = await get(`/api/simulator/customers?${qs}`, 'admin');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validacion');
  });
});
