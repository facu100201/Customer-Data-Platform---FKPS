import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Hash con pimienta de un identificador ya normalizado. Permite buscar sin guardar el valor en claro. */
export function hashIdentifier(pepper: string, type: string, normalized: string): string {
  return createHmac('sha256', pepper).update(`${type}:${normalized}`).digest('hex');
}

/** Las llaves de fuente y el token del sentinel se guardan solo como SHA-256. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): string {
  return `cdp_${randomBytes(24).toString('base64url')}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
