import { z } from 'zod';

try {
  process.loadEnvFile();
} catch {
  // sin .env: se usan las variables del entorno (servicio de Windows, CI)
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  IDENTITY_PEPPER: z.string().min(16),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SENTINEL_TOKEN: z.string().min(24).optional(),
  /** Intentos de login por IP y minuto. En CI se sube porque 20 navegadores entran desde 127.0.0.1. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida (revisa .env):\n${issues}`);
  }
  return parsed.data;
}
