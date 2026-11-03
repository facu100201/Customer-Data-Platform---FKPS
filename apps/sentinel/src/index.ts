import path from 'node:path';
import { z } from 'zod';
import { classify } from './ollama';
import { parseAccessLine, type AccessLine } from './parse';
import { DEFAULT_RULES, detect } from './rules';
import { FileTail } from './tail';

try {
  process.loadEnvFile();
} catch {
  // variables ya en el entorno
}

const env = z
  .object({
    APACHE_LOG_DIR: z.string().default('C:/Apache24/logs'),
    OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
    OLLAMA_MODEL: z.string().default('llama3.2:3b'),
    CDP_API_URL: z.string().url().default('http://127.0.0.1:3000'),
    SENTINEL_TOKEN: z.string().min(24),
    ZT_SUBNET: z.string().default(DEFAULT_RULES.ztSubnet),
    SENTINEL_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  })
  .parse(process.env);

// Apache Lounge en Windows escribe access.log y error.log (no access_log como en Linux)
const accessTail = new FileTail(path.join(env.APACHE_LOG_DIR, 'access.log'));
const headers = { 'Content-Type': 'application/json', 'x-sentinel-token': env.SENTINEL_TOKEN };

async function failedLogins(minutes: number) {
  try {
    const res = await fetch(`${env.CDP_API_URL}/api/security/signals?minutes=${minutes}`, { headers });
    if (!res.ok) return [];
    return ((await res.json()) as { failedLogins: { ip: string | null; count: number }[] }).failedLogins;
  } catch {
    return [];
  }
}

async function cycle() {
  const lines = (await accessTail.readNew()).map(parseAccessLine).filter((l): l is AccessLine => l !== null);
  const findings = detect(lines, await failedLogins(Math.ceil(env.SENTINEL_INTERVAL_SECONDS / 60)), {
    ...DEFAULT_RULES,
    ztSubnet: env.ZT_SUBNET,
  });
  for (const finding of findings) {
    const c = await classify(finding, { url: env.OLLAMA_URL, model: env.OLLAMA_MODEL });
    const res = await fetch(`${env.CDP_API_URL}/api/security/alerts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'apache',
        severity: c.severity,
        category: finding.category,
        summary: c.summary,
        excerpt: finding.excerpt.join('\n').slice(0, 4000),
        model: c.model,
      }),
    });
    console.log(`[sentinel] ${finding.category} ${finding.ip} → ${c.severity} (${c.model}) api=${res.status}`);
  }
  if (lines.length) console.log(`[sentinel] ${lines.length} líneas revisadas, ${findings.length} hallazgos`);
}

console.log(`[sentinel] vigilando ${env.APACHE_LOG_DIR} cada ${env.SENTINEL_INTERVAL_SECONDS}s con ${env.OLLAMA_MODEL}`);
const run = () => cycle().catch((err: unknown) => console.error('[sentinel] ciclo falló', err));
void run();
setInterval(run, env.SENTINEL_INTERVAL_SECONDS * 1000);
