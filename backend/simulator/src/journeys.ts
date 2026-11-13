import type { CdpEventInput } from '@cdp/shared';

/** Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma simulación. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Persona = {
  name: string;
  email: string;
  phone: string;
  /** Cada dispositivo tiene su propia cookie anónima; el CDP debe unirlos por email. */
  devices: { deviceId: string; anonymousId: string; userAgent: string; ip: string }[];
  interests: string[];
  /** 0–1: qué tanto compra. */
  propensity: number;
};

const NAMES = [
  'Ana',
  'Luis',
  'Sofía',
  'Diego',
  'Valeria',
  'Jorge',
  'Camila',
  'Mateo',
  'Regina',
  'Emilio',
  'Ximena',
  'Andrés',
];
const LAST = ['López', 'García', 'Martínez', 'Hernández', 'Ruiz', 'Torres', 'Flores', 'Vega'];
const CATEGORIES = ['tenis', 'running', 'hogar', 'electrónica', 'libros', 'café'];
const AGENTS = [
  'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1',
];
const PRODUCTS: Record<string, { sku: string; price: number }[]> = Object.fromEntries(
  CATEGORIES.map((c, i) => [
    c,
    [0, 1, 2].map((j) => ({
      sku: `${c.slice(0, 3).toUpperCase()}-${i}${j}`,
      price: 149 + (i * 3 + j) * 210,
    })),
  ]),
);

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const hex = (r: () => number, n: number) =>
  Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const uuid = (r: () => number) => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-a${hex(r, 3)}-${hex(r, 12)}`;

export function makePersonas(count: number, seed: number): Persona[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const first = pick(r, NAMES);
    const last = pick(r, LAST);
    const deviceCount = r() < 0.4 ? 2 : 1;
    return {
      name: `${first} ${last}`,
      email: `${first}.${last}.${i}@example.com`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
      phone: `55${String(10_000_000 + Math.floor(r() * 89_999_999))}`,
      devices: Array.from({ length: deviceCount }, () => ({
        deviceId: `dev-${hex(r, 10)}`,
        anonymousId: `anon-${uuid(r)}`,
        userAgent: pick(r, AGENTS),
        ip: `10.147.20.${10 + Math.floor(r() * 200)}`,
      })),
      interests: [pick(r, CATEGORIES), pick(r, CATEGORIES)],
      propensity: r(),
    };
  });
}

/**
 * Un journey reproduce el caso de objetivo.md: navega anónimo en un dispositivo, se identifica y
 * compra en otro, y a veces abre un ticket de soporte días después.
 */
export function journey(p: Persona, terminalId: string, now: Date, r: () => number): CdpEventInput[] {
  const events: CdpEventInput[] = [];
  let t = now.getTime() - Math.floor(r() * 40) * 86_400_000;
  const step = () => (t += Math.floor(30_000 + r() * 600_000));
  const at = () => new Date(Math.min(step(), now.getTime())).toISOString();

  const base = (d: Persona['devices'][number]) => ({
    anonymousId: d.anonymousId,
    terminalId,
    context: { ip: d.ip, userAgent: d.userAgent },
  });
  const [first, second = first] = p.devices as [Persona['devices'][number], ...Persona['devices']];

  // 1. navegación anónima
  events.push({
    ...base(first),
    eventId: uuid(r),
    category: 'behavior',
    name: 'app_open',
    occurredAt: at(),
    identifiers: { deviceId: first.deviceId },
  });
  for (const category of p.interests) {
    const product = pick(r, PRODUCTS[category] ?? []);
    events.push({
      ...base(first),
      eventId: uuid(r),
      category: 'behavior',
      name: 'product_view',
      occurredAt: at(),
      identifiers: { deviceId: first.deviceId },
      properties: { category, sku: product.sku, amount: product.price },
    });
  }
  if (r() > p.propensity) {
    events.push({
      ...base(first),
      eventId: uuid(r),
      category: 'behavior',
      name: 'cart_abandoned',
      occurredAt: at(),
      identifiers: { deviceId: first.deviceId },
      properties: { amount: 450 },
    });
  }

  // 2. se identifica (posiblemente en otro dispositivo) y compra
  events.push({
    ...base(second),
    eventId: uuid(r),
    category: 'profile',
    name: 'identify',
    occurredAt: at(),
    identifiers: { email: p.email, deviceId: second.deviceId },
    properties: { name: p.name },
  });
  // el primer dispositivo también se identifica alguna vez: así el CDP puede unir ambas cookies
  if (second !== first) {
    events.push({
      ...base(first),
      eventId: uuid(r),
      category: 'profile',
      name: 'identify',
      occurredAt: at(),
      identifiers: { email: p.email, deviceId: first.deviceId },
    });
  }
  const purchases = Math.floor(p.propensity * 4);
  for (let i = 0; i < purchases; i++) {
    const product = pick(r, PRODUCTS[pick(r, p.interests)] ?? []);
    events.push({
      ...base(second),
      eventId: uuid(r),
      category: 'transaction',
      name: 'purchase',
      occurredAt: at(),
      identifiers: { email: p.email },
      properties: { sku: product.sku, amount: product.price, category: p.interests[0] ?? null },
    });
  }

  // 3. soporte por teléfono
  if (r() < 0.3) {
    events.push({
      ...base(second),
      eventId: uuid(r),
      category: 'operational',
      name: 'support_ticket',
      occurredAt: at(),
      identifiers: { email: p.email, phone: p.phone },
      properties: { topic: pick(r, ['envío', 'devolución', 'factura']) },
    });
  }
  return events;
}
