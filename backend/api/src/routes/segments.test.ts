import type { Role, Rule } from '@cdp/shared';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { SESSION_COOKIE } from '../plugins/auth';
import { previewSegment, refreshSegment } from '../services/segments';

// Sin base de datos: el recálculo y la vista previa se prueban en services/segments.test.ts; aquí
// solo importa si se llaman y con qué.
vi.mock('../services/segments', () => ({
  refreshSegment: vi.fn(async () => 7),
  previewSegment: vi.fn(async () => ({ matches: 4, total: 10 })),
  runActivation: vi.fn(),
}));

const ID = '0b6f0a52-6f1e-4a57-9d3c-2b4e5f6a7b01';
const USER = '7d9f2a4e-1111-4c2b-9a3e-000000000001';

// Regla guardada en forma NO canónica (exists con value: null): no debe reescribirse si no se edita.
const SAVED_RULE = { all: [{ field: 'clv', op: 'exists', value: null }] };

type Stored = {
  id: string;
  name: string;
  description: string | null;
  definition: unknown;
  refreshedAt: Date | null;
};
let stored: Stored | null;
let updateError: unknown;
let createError: unknown;
let deleteError: unknown;
const calls = {
  delete: [] as { where: { id: string } }[],
  create: [] as { data: Record<string, unknown> }[],
  update: [] as { where: { id: string }; data: Record<string, unknown> }[],
  audit: [] as { data: Record<string, unknown> }[],
};

const prismaStub = {
  segment: {
    create: async (args: { data: Record<string, unknown> }) => {
      calls.create.push(args);
      if (createError) throw createError;
      return { id: ID, description: null, refreshedAt: null, ...args.data };
    },
    findUnique: async () => stored,
    findMany: async () => (stored ? [{ ...stored, _count: { memberships: 13, activations: 2 } }] : []),
    delete: async (args: { where: { id: string } }) => {
      calls.delete.push(args);
      if (deleteError) throw deleteError;
      return stored;
    },
    findUniqueOrThrow: async () => {
      if (!stored) throw new Error('no existe');
      return stored;
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      calls.update.push(args);
      if (updateError) throw updateError;
      stored = { ...stored!, ...args.data } as Stored;
      return stored;
    },
  },
  segmentMembership: { count: async () => 3 },
  auditLog: {
    create: async (args: { data: Record<string, unknown> }) => {
      calls.audit.push(args);
      return {};
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
  `${SESSION_COOKIE}=${app.jwt.sign({ sub: USER, email: `${role}@fkps.local`, role })}`;
const patch = (payload: unknown, { role = 'admin' as Role, id = ID } = {}) =>
  app.inject({
    method: 'PATCH',
    url: `/api/segments/${id}`,
    headers: { cookie: cookieFor(role) },
    payload: payload as object,
  });

beforeAll(async () => {
  app = await buildApp({ cfg, prisma: prismaStub });
});
afterAll(() => app.close());
beforeEach(() => {
  stored = {
    id: ID,
    name: 'Gastadores inactivos en app',
    description: 'descripción original',
    definition: SAVED_RULE,
    refreshedAt: null,
  };
  updateError = undefined;
  createError = undefined;
  deleteError = undefined;
  calls.delete = [];
  calls.create = [];
  calls.update = [];
  calls.audit = [];
  vi.mocked(refreshSegment).mockClear();
  vi.mocked(previewSegment).mockClear();
});

describe('PATCH /api/segments/:id · permisos y validación', () => {
  it('pide sesión', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${ID}`,
      payload: { name: 'Nuevo nombre' },
    });
    expect(res.statusCode).toBe(401);
  });

  it.each<Role>(['usuario', 'qa'])('%s no tiene segments:write', async (role) => {
    const res = await patch({ name: 'Nuevo nombre' }, { role });
    expect(res.statusCode).toBe(403);
    expect(calls.update).toHaveLength(0);
  });

  it.each<Role>(['admin', 'superusuario'])('%s puede editar', async (role) => {
    expect((await patch({ name: 'Nuevo nombre' }, { role })).statusCode).toBe(200);
  });

  it.each<[string, unknown]>([
    ['cuerpo vacío', {}],
    ['campo desconocido', { defintion: { all: [] } }],
    ['regla inválida', { definition: { all: [] } }],
    ['campo de perfil inexistente', { definition: { field: 'email', op: 'eq', value: 1 } }],
    ['nombre muy corto', { name: 'ab' }],
    ['descripción muy larga', { description: 'x'.repeat(501) }],
  ])('400 con %s, sin tocar la base', async (_name, payload) => {
    const res = await patch(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validacion');
    expect(calls.update).toHaveLength(0);
  });

  it('400 con un id que no es uuid', async () => {
    expect((await patch({ name: 'Nuevo nombre' }, { id: 'abc' })).statusCode).toBe(400);
  });

  it('404 si el segmento no existe', async () => {
    stored = null;
    const res = await patch({ name: 'Nuevo nombre' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('no_encontrado');
    expect(calls.update).toHaveLength(0);
  });

  it('404 si lo borran entre la lectura y la escritura (P2025)', async () => {
    updateError = Object.assign(new Error('not found'), { code: 'P2025' });
    expect((await patch({ name: 'Nuevo nombre' })).statusCode).toBe(404);
  });

  it('409 si el nombre ya lo usa otro segmento (P2002)', async () => {
    updateError = Object.assign(new Error('unique'), { code: 'P2002' });
    const res = await patch({ name: 'Otro segmento' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('nombre_duplicado');
  });

  it('500 con otros errores de la base', async () => {
    updateError = new Error('conexión perdida');
    expect((await patch({ name: 'Nuevo nombre' })).statusCode).toBe(500);
  });
});

describe('PATCH /api/segments/:id · qué se guarda', () => {
  it('cambiar solo el nombre no reescribe la regla ni recalcula', async () => {
    const res = await patch({ name: 'Nuevo nombre' });
    expect(res.statusCode).toBe(200);
    expect(calls.update[0]?.data).toEqual({ name: 'Nuevo nombre' });
    expect(refreshSegment).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({ name: 'Nuevo nombre', definition: SAVED_RULE, size: 3 });
  });

  it('la descripción se puede borrar con null', async () => {
    await patch({ description: null });
    expect(calls.update[0]?.data).toEqual({ description: null });
  });

  it('cambiar la regla la guarda tal cual llega y recalcula la membresía', async () => {
    const definition: Rule = {
      any: [
        { not: { field: 'days_since_app_open', op: 'exists' } },
        { field: 'spend_30d', op: 'gt', value: 100 },
      ],
    };
    const res = await patch({ definition });
    expect(res.statusCode).toBe(200);
    expect(calls.update[0]?.data).toEqual({ definition });
    expect(refreshSegment).toHaveBeenCalledWith(prismaStub, ID);
    expect(res.json()).toMatchObject({ definition, size: 7 });
  });

  it('audita los campos cambiados y guarda la regla y el nombre anteriores', async () => {
    const definition: Rule = { all: [{ field: 'clv', op: 'gte', value: 500 }] };
    await patch({ name: 'Nuevo nombre', definition });
    expect(calls.audit[0]?.data).toMatchObject({
      actorId: USER,
      action: 'segment.update',
      entity: 'segment',
      entityId: ID,
      meta: {
        fields: ['name', 'definition'],
        previousDefinition: SAVED_RULE,
        previousName: 'Gastadores inactivos en app',
      },
    });
  });

  it('sin cambio de regla la auditoría no copia la regla', async () => {
    await patch({ description: 'otra' });
    expect(calls.audit[0]?.data.meta).toEqual({ fields: ['description'] });
  });
});

const post = (url: string, payload: unknown, role?: Role) =>
  app.inject({
    method: 'POST',
    url,
    headers: role ? { cookie: cookieFor(role) } : {},
    payload: payload as object,
  });

describe('POST /api/segments · nombre repetido', () => {
  const body = { name: 'Gastadores inactivos en app', definition: SAVED_RULE };

  it('409 nombre_duplicado (antes 500) sin recalcular ni auditar', async () => {
    createError = Object.assign(new Error('unique'), { code: 'P2002' });
    const res = await post('/api/segments', body, 'admin');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'nombre_duplicado' });
    expect(refreshSegment).not.toHaveBeenCalled();
    expect(calls.audit).toHaveLength(0);
  });

  it('otros errores de la base siguen siendo 500', async () => {
    createError = new Error('conexión perdida');
    expect((await post('/api/segments', body, 'admin')).statusCode).toBe(500);
  });

  it('sin error crea, recalcula y audita como antes', async () => {
    const res = await post('/api/segments', body, 'admin');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: body.name, definition: SAVED_RULE, size: 7 });
    expect(refreshSegment).toHaveBeenCalledWith(prismaStub, ID);
    expect(calls.audit[0]?.data).toMatchObject({ action: 'segment.create', entityId: ID });
  });
});

describe('POST /api/segments/preview', () => {
  const definition: Rule = { any: [{ field: 'churn_score', op: 'gte', value: 0.7 }] };

  it('pide sesión', async () => {
    expect((await post('/api/segments/preview', { definition })).statusCode).toBe(401);
  });

  it.each<Role>(['usuario', 'qa'])('%s no tiene segments:write', async (role) => {
    const res = await post('/api/segments/preview', { definition }, role);
    expect(res.statusCode).toBe(403);
    expect(previewSegment).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'superusuario'])('%s recibe el conteo', async (role) => {
    const res = await post('/api/segments/preview', { definition }, role);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ matches: 4, total: 10 });
    expect(previewSegment).toHaveBeenCalledWith(prismaStub, definition);
  });

  it('no guarda nada: ni segmento, ni membresía, ni auditoría', async () => {
    await post('/api/segments/preview', { definition }, 'admin');
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(calls.audit).toHaveLength(0);
    expect(refreshSegment).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ['sin regla', {}],
    ['regla inválida', { definition: { all: [] } }],
    ['campo de perfil inexistente', { definition: { field: 'email', op: 'eq', value: 1 } }],
    ['campos de más', { definition, name: 'algo' }],
  ])('400 con %s', async (_name, payload) => {
    const res = await post('/api/segments/preview', payload, 'admin');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validacion');
    expect(previewSegment).not.toHaveBeenCalled();
  });
});

describe('GET /api/segments · conteos', () => {
  it('incluye el tamaño y cuántas activaciones se borrarían con el segmento', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/segments',
      headers: { cookie: cookieFor('usuario') },
    });
    expect(res.statusCode).toBe(200);
    const [row] = res.json();
    expect(row).toMatchObject({ id: ID, size: 13, activationCount: 2 });
    expect(row).not.toHaveProperty('_count');
  });
});

describe('DELETE /api/segments/:id', () => {
  const del = (role?: Role, id = ID) =>
    app.inject({
      method: 'DELETE',
      url: `/api/segments/${id}`,
      headers: role ? { cookie: cookieFor(role) } : {},
    });

  it('pide sesión', async () => {
    expect((await del()).statusCode).toBe(401);
  });

  it.each<Role>(['usuario', 'qa'])('%s no tiene segments:write', async (role) => {
    expect((await del(role)).statusCode).toBe(403);
    expect(calls.delete).toHaveLength(0);
  });

  it('borra y deja en la auditoría lo necesario para recrearlo', async () => {
    const res = await del('admin');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls.delete[0]?.where).toEqual({ id: ID });
    expect(calls.audit[0]?.data).toMatchObject({
      actorId: USER,
      action: 'segment.delete',
      entityId: ID,
      meta: {
        name: 'Gastadores inactivos en app',
        description: 'descripción original',
        definition: SAVED_RULE,
      },
    });
  });

  it('404 (antes 500) si no existe, sin auditar', async () => {
    stored = null;
    const res = await del('admin');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('no_encontrado');
    expect(calls.delete).toHaveLength(0);
    expect(calls.audit).toHaveLength(0);
  });

  it('404 si otro lo borró entre la lectura y el borrado (P2025)', async () => {
    deleteError = Object.assign(new Error('not found'), { code: 'P2025' });
    expect((await del('admin')).statusCode).toBe(404);
    expect(calls.audit).toHaveLength(0);
  });

  it('400 con un id que no es uuid', async () => {
    expect((await del('admin', 'abc')).statusCode).toBe(400);
  });
});
