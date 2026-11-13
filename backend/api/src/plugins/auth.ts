import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { Permission, Role } from '@cdp/shared';
import { can } from '@cdp/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { hashApiKey, safeEqual } from '../lib/crypto';

export const SESSION_COOKIE = 'cdp_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type SessionUser = { sub: string; email: string; role: Role };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionUser;
    user: SessionUser;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Fuente de datos autenticada con x-source-key (simulador, integraciones). */
    sourceId?: string;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (p: Permission) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateIngest: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateSentinel: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Se registra en la instancia raíz para que los decoradores sean visibles en todas las rutas. */
export async function setupAuth(app: FastifyInstance, cfg: Config): Promise<void> {
  await app.register(cookie);
  await app.register(jwt, {
    secret: cfg.JWT_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { expiresIn: SESSION_TTL_SECONDS },
  });

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'no_autenticado' });
    }
  };

  app.decorate('authenticate', authenticate);

  app.decorate(
    'requirePermission',
    (permission: Permission) => async (req: FastifyRequest, reply: FastifyReply) => {
      await authenticate(req, reply);
      if (reply.sent) return;
      if (!can(req.user.role, permission)) {
        return reply.code(403).send({ error: 'sin_permiso', permiso: permission });
      }
    },
  );

  // Ingesta: usuario con events:write (terminal web) o una fuente con llave
  app.decorate('authenticateIngest', async (req: FastifyRequest, reply: FastifyReply) => {
    const key = req.headers['x-source-key'];
    if (typeof key === 'string' && key.length > 0) {
      const source = await app.prisma.source.findUnique({ where: { apiKeyHash: hashApiKey(key) } });
      if (!source?.active) return reply.code(401).send({ error: 'llave_invalida' });
      req.sourceId = source.id;
      return;
    }
    return app.requirePermission('events:write')(req, reply);
  });

  app.decorate('authenticateSentinel', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.headers['x-sentinel-token'];
    if (!cfg.SENTINEL_TOKEN || typeof token !== 'string' || !safeEqual(token, cfg.SENTINEL_TOKEN)) {
      return reply.code(401).send({ error: 'token_invalido' });
    }
  });
}
