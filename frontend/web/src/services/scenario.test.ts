import {
  CHURN_COEFFICIENTS,
  CHURN_RISK_THRESHOLD,
  DEFAULT_CLV,
  computeChurn,
  computeClv,
  type ProfileAggregates,
} from '@cdp/engine';
import { PROFILE_FIELDS } from '@cdp/shared';
import { describe, expect, it } from 'vitest';
import {
  ALL_SLIDERS,
  DEFAULT_SCENARIO,
  clvBuckets,
  compareRisk,
  getParam,
  describeChanges,
  histogram,
  isDefault,
  niceRound,
  paramDiff,
  parseParams,
  sameParams,
  scoreCustomers,
  setParam,
  summarize,
  type SimCustomer,
} from './scenario';

const empty = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, null])) as ProfileAggregates;
const customer = (id: string, fields: Partial<ProfileAggregates>, tenureDays = 60): SimCustomer => ({
  id,
  tenureDays,
  aggregates: { ...empty, ...fields },
});

// activo: compra seguido → CLV alto, churn bajo · inactivo con tickets → churn alto · sin compras → CLV 0
const active = customer('a', {
  avg_order_value: 500,
  orders_30d: 2,
  orders_total: 6,
  days_since_last_event: 2,
  sessions_30d: 8,
});
const inactive = customer('b', {
  avg_order_value: 200,
  orders_30d: 0,
  orders_total: 2,
  days_since_last_event: 60,
  support_tickets_30d: 2,
});
const browser = customer('c', { days_since_last_event: 5, sessions_30d: 3, cart_abandoned_30d: 1 });
const all = [active, inactive, browser];

describe('valores por defecto', () => {
  it('son los del motor (lo que guarda la API) y el umbral de Clientes 360', () => {
    expect(DEFAULT_SCENARIO.clv).toEqual(DEFAULT_CLV);
    expect(DEFAULT_SCENARIO.churn).toEqual(CHURN_COEFFICIENTS);
    expect(DEFAULT_SCENARIO.riskThreshold).toBe(CHURN_RISK_THRESHOLD);
    expect(CHURN_RISK_THRESHOLD).toBe(0.7);
  });

  it('con los valores por defecto da lo mismo que computeClv y computeChurn', () => {
    const s = scoreCustomers(all, DEFAULT_SCENARIO);
    all.forEach((c, i) => {
      expect(s.clv[i]).toBe(computeClv(c.aggregates, c.tenureDays));
      expect(s.churn[i]).toBe(computeChurn(c.aggregates));
    });
  });
});

describe('escenarios', () => {
  it('el CLV escala con vida × margen', () => {
    const half = setParam(DEFAULT_SCENARIO, 'clv.lifespanMonths', 12);
    const base = scoreCustomers([active], DEFAULT_SCENARIO).clv[0]!;
    expect(scoreCustomers([active], half).clv[0]).toBe(base / 2);
    const doubleMargin = setParam(DEFAULT_SCENARIO, 'clv.margin', 0.6);
    expect(scoreCustomers([active], doubleMargin).clv[0]).toBe(base * 2);
  });

  it('los coeficientes de churn cambian la probabilidad', () => {
    const base = scoreCustomers([inactive], DEFAULT_SCENARIO).churn[0]!;
    const lessRecency = setParam(DEFAULT_SCENARIO, 'churn.recencyDays', 0.02);
    expect(scoreCustomers([inactive], lessRecency).churn[0]).toBeLessThan(base);
  });

  it('cuenta en riesgo desde el umbral inclusive (igual que el rojo de Clientes 360)', () => {
    const scores = { clv: [100, 200, 300], churn: [0.69, 0.7, 0.95] };
    expect(summarize(scores, 0.7)).toEqual({ customers: 3, atRisk: 2, totalClv: 600, clvAtRisk: 500 });
    expect(summarize(scores, 0.96).atRisk).toBe(0);
  });

  it('separa quién sigue, entra y sale del riesgo', () => {
    const base = { clv: [0, 0, 0, 0], churn: [0.9, 0.9, 0.2, 0.2] };
    const scen = { clv: [0, 0, 0, 0], churn: [0.9, 0.3, 0.8, 0.1] };
    expect(compareRisk(base, 0.7, scen, 0.7)).toEqual({ remain: 1, entering: 1, leaving: 1 });
    // bajar solo el umbral del escenario mete a más clientes
    expect(compareRisk(base, 0.7, base, 0.1)).toEqual({ remain: 2, entering: 2, leaving: 0 });
  });
});

describe('rangos de CLV', () => {
  it('redondea los cortes a 2 cifras significativas', () => {
    expect(niceRound(1234)).toBe(1200);
    expect(niceRound(74_282)).toBe(74_000);
    expect(niceRound(0.0456)).toBeCloseTo(0.046);
    expect(niceRound(0)).toBe(0);
  });

  it('separa el $0 y reparte los positivos en cortes crecientes', () => {
    const values = [0, 0, ...Array.from({ length: 100 }, (_, i) => (i + 1) * 137)];
    const buckets = clvBuckets(values);
    expect(buckets[0]).toMatchObject({ label: '$0', min: 0 });
    expect(buckets.at(-1)?.max).toBe(Infinity);
    for (let i = 1; i < buckets.length; i++) expect(buckets[i]!.min).toBe(buckets[i - 1]!.max);
    const counts = histogram(values, buckets);
    expect(counts[0]).toBe(2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(values.length);
    // con quintiles, cada rango positivo tiene alrededor de 20 clientes
    for (const c of counts.slice(1)) expect(c).toBeGreaterThan(10);
  });

  it('usa los mismos rangos para el escenario: lo que supera el último corte cae en el último rango', () => {
    const buckets = clvBuckets([100, 200, 300, 400, 500]);
    expect(histogram([1e9], buckets).at(-1)).toBe(1);
    expect(histogram([0], buckets)[0]).toBe(1);
    expect(histogram([0.01], buckets)[1]).toBe(1);
  });

  it('funciona sin compras y con un solo valor', () => {
    expect(clvBuckets([0, 0]).map((b) => b.label)).toEqual(['$0', '> $0']);
    const one = clvBuckets([250]);
    expect(histogram([250], one).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('controles', () => {
  it.each(ALL_SLIDERS.map((s) => [s.key, s] as const))(
    '%s: el valor por defecto está dentro del rango y sobre un paso del slider',
    (_, s) => {
      const v = getParam(DEFAULT_SCENARIO, s.key);
      expect(v).toBeGreaterThanOrEqual(s.min);
      expect(v).toBeLessThanOrEqual(s.max);
      const steps = (v - s.min) / s.step;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
    },
  );

  it('setParam no modifica el original y limita al rango', () => {
    const p = setParam(DEFAULT_SCENARIO, 'churn.tickets30d', 99);
    expect(p.churn.tickets30d).toBe(1.5);
    expect(DEFAULT_SCENARIO.churn.tickets30d).toBe(0.35);
    expect(setParam(DEFAULT_SCENARIO, 'clv.margin', Number.NaN)).toBe(DEFAULT_SCENARIO);
    expect(isDefault(DEFAULT_SCENARIO)).toBe(true);
    expect(isDefault(p)).toBe(false);
    expect(isDefault(setParam(p, 'churn.tickets30d', 0.35))).toBe(true);
  });
});

describe('escenarios guardados', () => {
  const custom = setParam(setParam(DEFAULT_SCENARIO, 'clv.lifespanMonths', 36), 'riskThreshold', 0.5);

  it('lo guardado se lee igual (ida y vuelta por JSON, como IndexedDB)', () => {
    const back = parseParams(JSON.parse(JSON.stringify(custom)));
    expect(back).toEqual(custom);
    expect(back && sameParams(back, custom)).toBe(true);
  });

  it('descarta formatos inválidos', () => {
    expect(parseParams(null)).toBeNull();
    expect(parseParams('escenario')).toBeNull();
    expect(parseParams({})).toBeNull();
    const missing = JSON.parse(JSON.stringify(custom));
    delete missing.churn.tickets30d;
    expect(parseParams(missing)).toBeNull();
    expect(parseParams({ ...custom, riskThreshold: '0.5' })).toBeNull();
    expect(parseParams({ ...custom, clv: { ...custom.clv, margin: null } })).toBeNull();
    // JSON convierte NaN e Infinity en null
    expect(parseParams(JSON.parse(JSON.stringify({ ...custom, riskThreshold: Number.NaN })))).toBeNull();
  });

  it('limita valores fuera de rango e ignora campos desconocidos', () => {
    const back = parseParams({ ...custom, clv: { ...custom.clv, margin: 7 }, extra: 1 });
    expect(back?.clv.margin).toBe(1);
    expect(back).not.toHaveProperty('extra');
  });

  it('compara dos escenarios control por control', () => {
    const other = setParam(custom, 'clv.margin', 0.6);
    expect(paramDiff(custom, custom)).toEqual([]);
    expect(paramDiff(custom, other)).toEqual([{ key: 'clv.margin', label: 'Margen', a: '30%', b: '60%' }]);
    expect(paramDiff(DEFAULT_SCENARIO, other).map((d) => d.key)).toEqual([
      'clv.lifespanMonths',
      'clv.margin',
      'riskThreshold',
    ]);
  });

  it('describe solo lo que cambia respecto a los valores por defecto', () => {
    expect(describeChanges(DEFAULT_SCENARIO)).toEqual([]);
    expect(describeChanges(custom)).toEqual([
      { key: 'clv.lifespanMonths', label: 'Vida del cliente', value: '36 meses' },
      { key: 'riskThreshold', label: 'Umbral de riesgo', value: '50%' },
    ]);
  });
});
