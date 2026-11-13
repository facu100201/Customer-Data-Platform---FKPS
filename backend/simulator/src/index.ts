/**
 * Simulador de dumb terminals. Cada terminal virtual manda heartbeats y journeys de clientes al CDP
 * a través de Apache, igual que lo haría un equipo real conectado por ZeroTier.
 *
 *   npm run sim -- --url http://10.147.20.5 --terminals 25 --minutes 5
 *   npm run sim -- --terminals 25 --dry-run      (no envía nada; valida los eventos contra el esquema)
 */
import { parseArgs } from 'node:util';
import { eventSchema, type CdpEventInput } from '@cdp/shared';
import { journey, makePersonas, rng } from './journeys';

try {
  process.loadEnvFile();
} catch {
  // sin .env
}

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.CDP_URL ?? 'http://127.0.0.1' },
    terminals: { type: 'string', default: '25' },
    customers: { type: 'string', default: '0' },
    minutes: { type: 'string', default: '2' },
    seed: { type: 'string', default: '2026' },
    key: { type: 'string', default: process.env.SIM_SOURCE_KEY ?? '' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const terminals = Number(values.terminals);
const customersPerTerminal = Number(values.customers) || 4;
const durationMs = Number(values.minutes) * 60_000;
const dryRun = values['dry-run'];
const base = values.url.replace(/\/$/, '');

if (!dryRun && !values.key) {
  console.error('Falta la llave de la fuente: define SIM_SOURCE_KEY en .env o usa --key');
  process.exit(1);
}

const stats = { sent: 0, rejected: 0, errors: 0, invalid: 0, latencies: [] as number[] };

async function post(path: string, body: unknown) {
  const started = performance.now();
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-source-key': values.key },
    body: JSON.stringify(body),
  });
  stats.latencies.push(performance.now() - started);
  return res;
}

async function runTerminal(index: number) {
  const id = `sim-${String(index + 1).padStart(2, '0')}`;
  const r = rng(Number(values.seed) + index);
  const personas = makePersonas(customersPerTerminal, Number(values.seed) * 100 + index);
  const events: CdpEventInput[] = personas.flatMap((p) => journey(p, id, new Date(), r));

  for (const e of events) {
    if (!eventSchema.safeParse(e).success) stats.invalid++;
  }
  if (dryRun) {
    stats.sent += events.length;
    return;
  }

  const deadline = Date.now() + durationMs;
  const gap = Math.max(50, durationMs / Math.max(1, events.length));
  let lastBeat = 0;
  for (const event of events) {
    if (Date.now() > deadline) break;
    try {
      if (Date.now() - lastBeat > 20_000) {
        await post('/terminals/heartbeat', { terminalId: id, label: `Simulada ${index + 1}` });
        lastBeat = Date.now();
      }
      const res = await post('/events', event);
      if (res.ok) stats.sent++;
      else stats.rejected++;
    } catch {
      stats.errors++;
    }
    await new Promise((resolve) => setTimeout(resolve, gap * (0.5 + r())));
  }
}

const started = Date.now();
console.log(
  `${dryRun ? '[dry-run] ' : ''}${terminals} terminales × ${customersPerTerminal} clientes → ${dryRun ? 'sin envío' : base}`,
);
await Promise.all(Array.from({ length: terminals }, (_, i) => runTerminal(i)));

const sorted = [...stats.latencies].sort((a, b) => a - b);
const p = (q: number) => (sorted.length ? sorted[Math.floor(q * (sorted.length - 1))]!.toFixed(0) : '–');
console.log(
  [
    `eventos ${dryRun ? 'generados' : 'aceptados'}: ${stats.sent}`,
    `inválidos según esquema: ${stats.invalid}`,
    `rechazados: ${stats.rejected}`,
    `errores de red: ${stats.errors}`,
    `latencia p50/p95: ${p(0.5)}/${p(0.95)} ms`,
    `duración: ${((Date.now() - started) / 1000).toFixed(1)} s`,
  ].join('\n'),
);
// En CI este proceso es la prueba de carga: debe fallar si el servidor rechazó o no recibió eventos
const delivered = dryRun || (stats.sent > 0 && stats.rejected === 0 && stats.errors === 0);
if (stats.invalid > 0 || !delivered) process.exitCode = 1;
