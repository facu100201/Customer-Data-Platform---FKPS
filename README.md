# Customer-Data-Platform---FKPS

Customer Data Platform (CDP) simulado del equipo FKPS: unifica identidades de clientes, calcula CLV y churn,
segmenta y activa audiencias. Se sirve con Apache sobre una red ZeroTier.

## Estructura

```
frontend/
  web/         @cdp/web          React + Vite: dashboard, terminal, clientes, segmentos
  desktop/     @cdp/desktop      Electron: terminal ligera que carga la web
backend/
  api/         @cdp/api          Fastify: auth, RBAC, ingesta de eventos, SSE
  engine/      @cdp/engine       Lógica pura: resolución de identidad, agregados, CLV, churn
  sentinel/    @cdp/sentinel     Vigila los logs de Apache y clasifica alertas con Ollama
  simulator/   @cdp/sim-terminals Genera tráfico de N terminales contra la API
db/            @cdp/db           Esquema Prisma, migraciones, seed y setup de PostgreSQL
shared/        @cdp/shared       Tipos y esquemas zod compartidos (roles, eventos, segmentos)
e2e/                             Pruebas Playwright
infra/                           Apache, Ollama y scripts de despliegue en Windows
docs/                            Objetivo y documentación del proyecto
```

## Requisitos

- Node.js 22 (ver `.nvmrc`)
- PostgreSQL 16

## Primeros pasos

```bash
npm ci
cp .env.example backend/api/.env     # y db/.env para el seed; llena los valores
npm run db:migrate
npm run db:seed
npm run dev:api                      # http://127.0.0.1:3000
npm run dev:web                      # http://127.0.0.1:5173
```

## Comandos

| Comando                 | Qué hace                                       |
| ----------------------- | ---------------------------------------------- |
| `npm run lint`          | ESLint en todo el monorepo                     |
| `npm run format:check`  | Verifica formato con Prettier                  |
| `npm run typecheck`     | `tsc` en cada workspace                        |
| `npm test`              | Pruebas unitarias (Vitest)                     |
| `npm run test:e2e`      | Pruebas E2E (requiere Postgres con migraciones y seed) |
| `npm run build`         | Compila api, sentinel y web                    |
| `npm run db:migrate`    | Aplica migraciones (`db/prisma/migrations`)    |
| `npm run sim -- --terminals 25 --dry-run` | Simulador de terminales (sin `--dry-run` envía a la API) |
