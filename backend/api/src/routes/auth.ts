import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '../plugins/auth';

const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(256) });

export async function authRoutes(app: FastifyInstance) {
  // Hash de una contraseña aleatoria: así un email inexistente tarda lo mismo que uno real
  const DUMMY_HASH = await hash(randomBytes(16).toString('hex'));

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: app.cfg.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password } = loginSchema.parse(req.body);
      const user = await app.prisma.appUser.findUnique({ where: { email: email.toLowerCase() } });
      const ok = await verify(user?.passwordHash ?? DUMMY_HASH, password).catch(() => false);

      if (!user || !user.active || !ok) {
        audit(app.prisma, { action: 'auth.login_failed', ip: req.ip, meta: { email } });
        return reply.code(401).send({ error: 'credenciales_invalidas' });
      }

      await app.prisma.appUser.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
      audit(app.prisma, { actorId: user.id, action: 'auth.login', ip: req.ip });

      const session = { sub: user.id, email: user.email, role: user.role };
      const token = await reply.jwtSign(session);
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: app.cfg.COOKIE_SECURE,
        maxAge: SESSION_TTL_SECONDS,
      });
      return { user: { id: user.id, email: user.email, role: user.role } };
    },
  );

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => ({
    user: { id: req.user.sub, email: req.user.email, role: req.user.role },
  }));
}
