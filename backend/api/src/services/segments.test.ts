import type { Rule } from '@cdp/shared';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { matchCustomers, previewSegment, refreshSegment } from './segments';

type Customer = { id: string; aggregates: { spend_30d: number | null } };
type FindManyArgs = { take: number; skip?: number; cursor?: { id: string } };

// 2500 perfiles: tres páginas de 1000 (la última incompleta). Gasto 0..2499; cada 10º sin gasto.
const CUSTOMERS: Customer[] = Array.from({ length: 2500 }, (_, i) => ({
  id: `c${String(i).padStart(5, '0')}`,
  aggregates: { spend_30d: i % 10 === 0 ? null : i },
}));

/** Paginación por cursor como la hace Prisma (orden por id, skip 1 para saltar el cursor). */
function findMany(args: FindManyArgs): Promise<Customer[]> {
  const start = args.cursor ? CUSTOMERS.findIndex((c) => c.id === args.cursor!.id) + (args.skip ?? 0) : 0;
  return Promise.resolve(CUSTOMERS.slice(start, start + args.take));
}

/**
 * Prisma de solo lectura que registra cada modelo y método usado. Cualquier cosa que no sea
 * customer.findMany queda en `touched`, y las pruebas exigen que no haya nada más.
 */
function readOnlyPrisma() {
  const touched: string[] = [];
  const pages: FindManyArgs[] = [];
  const customer = new Proxy(
    {},
    {
      get: (_t, method) => {
        touched.push(`customer.${String(method)}`);
        if (method === 'findMany')
          return (args: FindManyArgs) => {
            pages.push(args);
            return findMany(args);
          };
        throw new Error(`customer.${String(method)} no permitido en vista previa`);
      },
    },
  );
  const prisma = new Proxy(
    {},
    {
      get: (_t, model) => {
        if (model === 'customer') return customer;
        touched.push(String(model));
        throw new Error(`${String(model)} no permitido en vista previa`);
      },
    },
  ) as unknown as PrismaClient;
  return { prisma, touched, pages };
}

const rule: Rule = { all: [{ field: 'spend_30d', op: 'gte', value: 2000 }] };
const expected = CUSTOMERS.filter((c) => c.aggregates.spend_30d !== null && c.aggregates.spend_30d >= 2000);

describe('matchCustomers', () => {
  it('recorre todas las páginas y evalúa cada perfil una vez', async () => {
    const { prisma, pages } = readOnlyPrisma();
    const { members, total } = await matchCustomers(prisma, rule);
    expect(total).toBe(2500);
    expect(members).toEqual(expected.map((c) => c.id));
    expect(new Set(members).size).toBe(members.length);
    expect(pages.map((p) => p.cursor?.id ?? null)).toEqual([null, 'c00999', 'c01999']);
  });

  it('sin perfiles devuelve cero', async () => {
    const prisma = { customer: { findMany: async () => [] } } as unknown as PrismaClient;
    expect(await matchCustomers(prisma, rule)).toEqual({ members: [], total: 0 });
  });
});

describe('previewSegment', () => {
  it('cuenta coincidencias y total, y solo lee perfiles', async () => {
    const { prisma, touched } = readOnlyPrisma();
    expect(await previewSegment(prisma, rule)).toEqual({ matches: expected.length, total: 2500 });
    expect(new Set(touched)).toEqual(new Set(['customer.findMany']));
  });

  it('un campo nulo no cumple la comparación, igual que al guardar', async () => {
    const { prisma } = readOnlyPrisma();
    const r = await previewSegment(prisma, { not: { field: 'spend_30d', op: 'exists' } });
    expect(r.matches).toBe(250); // los 250 perfiles sin gasto
  });
});

describe('refreshSegment', () => {
  it('guarda como membresía exactamente los perfiles que cuenta la vista previa', async () => {
    const writes: { createMany?: string[]; deleted?: string; updated?: string } = {};
    const prisma = {
      segment: {
        findUniqueOrThrow: async () => ({ id: 's1', definition: rule }),
        update: (args: { where: { id: string } }) => {
          writes.updated = args.where.id;
          return 'update';
        },
      },
      customer: { findMany },
      segmentMembership: {
        deleteMany: (args: { where: { segmentId: string } }) => {
          writes.deleted = args.where.segmentId;
          return 'delete';
        },
        createMany: (args: { data: { customerId: string }[] }) => {
          writes.createMany = args.data.map((d) => d.customerId);
          return 'create';
        },
      },
      $transaction: async (ops: unknown[]) => ops,
    } as unknown as PrismaClient;

    const size = await refreshSegment(prisma, 's1');
    const preview = await previewSegment(readOnlyPrisma().prisma, rule);
    expect(size).toBe(preview.matches);
    expect(writes).toEqual({ createMany: expected.map((c) => c.id), deleted: 's1', updated: 's1' });
  });
});
