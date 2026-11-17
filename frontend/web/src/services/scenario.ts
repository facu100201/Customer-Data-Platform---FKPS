import {
  CHURN_COEFFICIENTS,
  CHURN_RISK_THRESHOLD,
  DEFAULT_CLV,
  computeChurn,
  computeClv,
  type ChurnCoefficients,
  type ClvParams,
  type ProfileAggregates,
} from '@cdp/engine';

/**
 * Lógica del simulador de escenarios, sin React: recalcula CLV y churn de cada perfil con las mismas
 * funciones del motor que usa la API y compara el escenario contra los valores por defecto.
 */

export type ScenarioParams = {
  clv: ClvParams;
  churn: ChurnCoefficients;
  /** Probabilidad de churn desde la que un cliente cuenta como "en riesgo" (inclusive). */
  riskThreshold: number;
};

export const DEFAULT_SCENARIO: ScenarioParams = {
  clv: { ...DEFAULT_CLV },
  churn: { ...CHURN_COEFFICIENTS },
  riskThreshold: CHURN_RISK_THRESHOLD,
};

/** Perfil tal como lo necesita el simulador (ver GET /api/simulator/customers). */
export type SimCustomer = { id: string; tenureDays: number; aggregates: ProfileAggregates };

export type Scores = { clv: number[]; churn: number[] };

export function scoreCustomers(customers: readonly SimCustomer[], params: ScenarioParams): Scores {
  const clv: number[] = [];
  const churn: number[] = [];
  for (const c of customers) {
    clv.push(computeClv(c.aggregates, c.tenureDays, params.clv));
    churn.push(computeChurn(c.aggregates, params.churn));
  }
  return { clv, churn };
}

export const isAtRisk = (churn: number, threshold: number) => churn >= threshold;

export type Summary = {
  customers: number;
  atRisk: number;
  totalClv: number;
  /** CLV de los clientes en riesgo: el valor que se perdería si se van. */
  clvAtRisk: number;
};

export function summarize(scores: Scores, threshold: number): Summary {
  let atRisk = 0;
  let totalClv = 0;
  let clvAtRisk = 0;
  scores.clv.forEach((clv, i) => {
    totalClv += clv;
    if (isAtRisk(scores.churn[i] ?? 0, threshold)) {
      atRisk += 1;
      clvAtRisk += clv;
    }
  });
  const cents = (n: number) => Math.round(n * 100) / 100;
  return { customers: scores.clv.length, atRisk, totalClv: cents(totalClv), clvAtRisk: cents(clvAtRisk) };
}

export type RiskChange = {
  /** En riesgo con los valores por defecto y también en el escenario. */
  remain: number;
  /** En riesgo solo en el escenario. */
  entering: number;
  /** En riesgo solo con los valores por defecto. */
  leaving: number;
};

export function compareRisk(
  base: Scores,
  baseThreshold: number,
  scenario: Scores,
  scenarioThreshold: number,
): RiskChange {
  const out: RiskChange = { remain: 0, entering: 0, leaving: 0 };
  base.churn.forEach((b, i) => {
    const before = isAtRisk(b, baseThreshold);
    const after = isAtRisk(scenario.churn[i] ?? 0, scenarioThreshold);
    if (before && after) out.remain += 1;
    else if (after) out.entering += 1;
    else if (before) out.leaving += 1;
  });
  return out;
}

// --- Distribución de CLV ---------------------------------------------------------------------------

/** Rango [min, max). El primero es exactamente 0 (clientes sin compras). */
export type Bucket = { label: string; min: number; max: number };

const compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });
export const moneyCompact = (v: number) => `$${compact.format(v)}`;

/** Redondea a 2 cifras significativas para que los cortes sean legibles (1 234 → 1 200). */
export function niceRound(v: number): number {
  if (v <= 0) return 0;
  const p = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}

/**
 * Rangos de CLV a partir de la distribución por defecto: "$0" y luego cortes en los cuantiles de los
 * CLV positivos (quintiles con bins = 5). Se calculan una vez con los valores por defecto y se usan
 * para ambas series, así las barras del escenario se comparan contra los mismos rangos.
 */
export function clvBuckets(baselineClv: readonly number[], bins = 5): Bucket[] {
  const zero: Bucket = { label: '$0', min: 0, max: Number.MIN_VALUE };
  const positive = baselineClv.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return [zero, { label: '> $0', min: Number.MIN_VALUE, max: Infinity }];

  const cuts: number[] = [];
  for (let k = 1; k < bins; k++) {
    const q = positive[Math.min(positive.length - 1, Math.floor((k * positive.length) / bins))] ?? 0;
    const cut = niceRound(q);
    if (cut > 0 && cut > (cuts.at(-1) ?? 0)) cuts.push(cut);
  }

  const buckets: Bucket[] = [zero];
  let prev = Number.MIN_VALUE;
  for (const cut of cuts) {
    buckets.push({
      label:
        prev === Number.MIN_VALUE ? `< ${moneyCompact(cut)}` : `${moneyCompact(prev)}–${moneyCompact(cut)}`,
      min: prev,
      max: cut,
    });
    prev = cut;
  }
  buckets.push({
    label: prev === Number.MIN_VALUE ? '> $0' : `≥ ${moneyCompact(prev)}`,
    min: prev,
    max: Infinity,
  });
  return buckets;
}

export function histogram(values: readonly number[], buckets: readonly Bucket[]): number[] {
  const counts = buckets.map(() => 0);
  for (const v of values) {
    const i = buckets.findIndex((b) => v >= b.min && v < b.max);
    // negativos no deberían existir (CLV ≥ 0); si aparecen cuentan como $0
    counts[i === -1 ? 0 : i] = (counts[i === -1 ? 0 : i] ?? 0) + 1;
  }
  return counts;
}

// --- Controles -----------------------------------------------------------------------------------

export type SliderKey = `clv.${keyof ClvParams}` | `churn.${keyof ChurnCoefficients}` | 'riskThreshold';

export type SliderDef = {
  key: SliderKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (decimals: number) => (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(decimals)}`;

export const CLV_SLIDERS: SliderDef[] = [
  {
    key: 'clv.lifespanMonths',
    label: 'Vida del cliente',
    hint: 'Meses que se espera que siga comprando',
    min: 1,
    max: 60,
    step: 1,
    format: (v) => `${v} meses`,
  },
  {
    key: 'clv.margin',
    label: 'Margen',
    hint: 'Margen bruto sobre cada compra',
    min: 0.01,
    max: 1,
    step: 0.01,
    format: pct,
  },
];

export const CHURN_SLIDERS: SliderDef[] = [
  {
    key: 'churn.intercept',
    label: 'Riesgo base (intercepto)',
    hint: 'Punto de partida del modelo logístico',
    min: -6,
    max: 2,
    step: 0.1,
    format: signed(1),
  },
  {
    key: 'churn.recencyDays',
    label: 'Días desde el último evento',
    hint: 'Peso por cada día sin actividad (tope 180)',
    min: 0,
    max: 0.2,
    step: 0.005,
    format: signed(3),
  },
  {
    key: 'churn.orders30d',
    label: 'Pedidos en 30 días',
    hint: 'Peso por pedido reciente (negativo = retiene)',
    min: -2,
    max: 0.5,
    step: 0.05,
    format: signed(2),
  },
  {
    key: 'churn.sessions30d',
    label: 'Sesiones en 30 días',
    hint: 'Peso por sesión reciente (tope 30)',
    min: -0.6,
    max: 0.2,
    step: 0.01,
    format: signed(2),
  },
  {
    key: 'churn.tickets30d',
    label: 'Tickets de soporte en 30 días',
    hint: 'Peso por ticket reciente',
    min: -0.5,
    max: 1.5,
    step: 0.05,
    format: signed(2),
  },
  {
    key: 'churn.cartAbandoned30d',
    label: 'Carritos abandonados en 30 días',
    hint: 'Peso por carrito abandonado reciente',
    min: -0.5,
    max: 1,
    step: 0.05,
    format: signed(2),
  },
];

export const RISK_SLIDER: SliderDef = {
  key: 'riskThreshold',
  label: 'Umbral de riesgo',
  hint: 'Churn desde el que un cliente cuenta como en riesgo',
  min: 0.05,
  max: 0.95,
  step: 0.05,
  format: pct,
};

export const ALL_SLIDERS = [...CLV_SLIDERS, ...CHURN_SLIDERS, RISK_SLIDER];

export function getParam(p: ScenarioParams, key: SliderKey): number {
  if (key === 'riskThreshold') return p.riskThreshold;
  const [group, field] = key.split('.') as ['clv' | 'churn', string];
  return (p[group] as Record<string, number>)[field] ?? 0;
}

/** Devuelve una copia con el valor cambiado, limitado al rango del control. */
export function setParam(p: ScenarioParams, key: SliderKey, value: number): ScenarioParams {
  const def = ALL_SLIDERS.find((s) => s.key === key);
  if (!def || !Number.isFinite(value)) return p;
  const v = Math.min(def.max, Math.max(def.min, value));
  if (key === 'riskThreshold') return { ...p, riskThreshold: v };
  const [group, field] = key.split('.') as ['clv' | 'churn', string];
  return { ...p, [group]: { ...p[group], [field]: v } };
}

export const sameParams = (a: ScenarioParams, b: ScenarioParams) =>
  ALL_SLIDERS.every((s) => getParam(a, s.key) === getParam(b, s.key));

export const isDefault = (p: ScenarioParams) => sameParams(p, DEFAULT_SCENARIO);

/** Controles que difieren de los valores por defecto, para describir un escenario guardado. */
export const describeChanges = (p: ScenarioParams) =>
  ALL_SLIDERS.filter((s) => getParam(p, s.key) !== getParam(DEFAULT_SCENARIO, s.key)).map((s) => ({
    key: s.key,
    label: s.label,
    value: s.format(getParam(p, s.key)),
  }));

/** Controles en los que difieren dos escenarios, con ambos valores ya formateados. */
export const paramDiff = (a: ScenarioParams, b: ScenarioParams) =>
  ALL_SLIDERS.filter((s) => getParam(a, s.key) !== getParam(b, s.key)).map((s) => ({
    key: s.key,
    label: s.label,
    a: s.format(getParam(a, s.key)),
    b: s.format(getParam(b, s.key)),
  }));

/**
 * Convierte lo leído de IndexedDB en parámetros válidos. Lo guardado puede venir de otra versión de
 * la app o estar editado a mano: cada control debe ser un número finito (si no, el escenario se
 * descarta) y se limita al rango actual del slider. Los campos desconocidos se ignoran.
 */
export function parseParams(raw: unknown): ScenarioParams | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const src = raw as Record<string, unknown>;
  let out = DEFAULT_SCENARIO;
  for (const s of ALL_SLIDERS) {
    const [group, field] = s.key.split('.') as [string, string | undefined];
    const value =
      field === undefined ? src[group] : (src[group] as Record<string, unknown> | undefined)?.[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    out = setParam(out, s.key, value);
  }
  return out;
}
