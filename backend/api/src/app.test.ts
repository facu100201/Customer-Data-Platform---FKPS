import type { Role } from '@cdp/shared';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { SESSION_COOKIE } from './plugins/auth';

// Sin base de datos: estas pruebas cubren lo que se decide antes de tocar Postgres (auth y RBAC).
const prismaStub = {
  $queryRaw: () => Promise.reject(new Error('sin BD en pruebas unitarias')),
  source: { findUnique: async () => null },
} as unknown as PrismaClient;

const cfg = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://x:y@127.0.0.1:5432/test',
  JWT_SECRET: 'x'.repeat(40),
  IDENTITY_PEPPER: 'p'.repeat(20),
  SENTINEL_TOKEN: 's'.repeat(30),
});

let app: Awaited<ReturnType<typeof buildApp>>;
const cookieFor = (role: Role) =>
  `${SESSION_COOKIE}=${app.jwt.sign({ sub: '00000000-0000-0000-0000-000000000001', email: `${role}@fkps.local`, role })}`;

beforeAll(async () => {
  app = await buildApp({ cfg, prisma: prismaStub });
});
afterAll(() => app.close());

describe('API sin sesión', () => {
  it('health responde aunque la BD no esté', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'down' });
  });

  it('rechaza rutas protegidas sin cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(res.statusCode).toBe(401);
  });

  it('rechaza ingesta con llave de fuente inválida', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { 'x-source-key': 'cdp_falsa' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('rechaza alertas del sentinel sin token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/security/alerts', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('RBAC', () => {
  it.each<[Role, string, string, number]>([
    ['qa', 'POST', '/api/segments', 403],
    ['usuario', 'GET', '/api/security/alerts', 403],
    ['usuario', 'GET', '/api/users', 403],
    ['admin', 'POST', '/api/security/alerts/00000000-0000-0000-0000-000000000009/ack', 403],
    ['qa', 'POST', '/api/events', 403],
  ])('%s → %s %s = %i', async (role, method, url, status) => {
    const res = await app.inject({
      method: method as 'GET' | 'POST',
      url,
      headers: { cookie: cookieFor(role) },
      payload: method === 'POST' ? {} : undefined,
    });
    expect(res.statusCode).toBe(status);
  });

  it('valida el cuerpo del evento después de autorizar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { cookie: cookieFor('usuario') },
      payload: { category: 'behavior', name: 'Page View', anonymousId: 'a', occurredAt: 'ayer' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validacion');
  });

  it('responde 400 (no 500) si el cuerpo del evento es un JSON primitivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { cookie: cookieFor('usuario'), 'content-type': 'application/json' },
      payload: '5',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validacion');
  });

  it('/auth/me devuelve el rol de la sesión', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieFor('superusuario') },
    });
    expect(res.json().user.role).toBe('superusuario');
  });
});
