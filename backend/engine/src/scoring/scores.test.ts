import { describe, expect, it } from 'vitest';
import { computeAggregates, type EngineEvent, type ProfileAggregates } from '../segmentation/aggregates';
import { CHURN_COEFFICIENTS, computeChurn, computeClv, computeRfm, type ChurnCoefficients } from './scores';

const now = new Date('2026-11-02T12:00:00Z');
/** Agregados vacíos con los campos indicados; evita depender del cálculo de agregados. */
const aggWith = (fields: Partial<ProfileAggregates>): ProfileAggregates => ({
  ...computeAggregates([], now),
  ...fields,
});

const ev = (name: string, d: number, amount?: number): EngineEvent => ({
  category: 'transaction',
  name,
  occurredAt: new Date(now.getTime() - d * 86_400_000),
  properties: amount === undefined ? {} : { amount },
});

describe('CLV', () => {
  it('ticket 50 × 2 compras/mes × 24 meses × 30% de margen = 720', () => {
    const agg = computeAggregates([ev('purchase', 1, 50), ev('purchase', 8, 50)], now);
    expect(computeClv(agg, 30)).toBe(720);
  });

  it('es 0 sin compras', () => {
    expect(computeClv(computeAggregates([], now), 10)).toBe(0);
  });

  it('acepta parámetros propios: ticket 50 × 2 compras/mes × 12 meses × 50% = 600', () => {
    const agg = computeAggregates([ev('purchase', 1, 50), ev('purchase', 8, 50)], now);
    expect(computeClv(agg, 30, { lifespanMonths: 12, margin: 0.5 })).toBe(600);
  });
});

describe('churn', () => {
  it('un cliente activo tiene probabilidad baja', () => {
    const events = [
      ev('purchase', 1, 30),
      ev('purchase', 4, 30),
      ...Array.from({ length: 10 }, () => ev('page_view', 2)),
    ];
    expect(computeChurn(computeAggregates(events, now))).toBeLessThan(0.1);
  });

  it('un cliente inactivo con tickets tiene probabilidad alta', () => {
    const events = [ev('purchase', 90, 30), ev('support_ticket', 89), ev('support_ticket', 88)];
    expect(computeChurn(computeAggregates(events, now))).toBeGreaterThan(0.9);
  });
});

describe('churn con coeficientes propios', () => {
  // z = −2 + 0.08·10 − 0.6·1 − 0.15·5 + 0.35·1 + 0.2·2 = −1.8  →  1 / (1 + e^1.8) = 0.142
  const agg = aggWith({
    days_since_last_event: 10,
    orders_30d: 1,
    sessions_30d: 5,
    support_tickets_30d: 1,
    cart_abandoned_30d: 2,
  });
  const zero: ChurnCoefficients = {
    intercept: 0,
    recencyDays: 0,
    orders30d: 0,
    sessions30d: 0,
    tickets30d: 0,
    cartAbandoned30d: 0,
  };

  it('sin coeficientes da lo mismo que con CHURN_COEFFICIENTS (lo que guarda la API)', () => {
    expect(computeChurn(agg)).toBe(0.142);
    expect(computeChurn(agg, CHURN_COEFFICIENTS)).toBe(0.142);
  });

  it('usa los coeficientes recibidos', () => {
    expect(computeChurn(agg, zero)).toBe(0.5);
    expect(computeChurn(agg, { ...zero, intercept: -2 })).toBe(0.119);
    expect(computeChurn(agg, { ...CHURN_COEFFICIENTS, tickets30d: 2.15 })).toBe(0.5);
  });

  it('subir el peso de la recencia sube la probabilidad', () => {
    const heavier = { ...CHURN_COEFFICIENTS, recencyDays: 0.2 };
    expect(computeChurn(agg, heavier)).toBeGreaterThan(computeChurn(agg));
  });

  it('mantiene los topes de recencia (180 días) y sesiones (30)', () => {
    const c = { ...zero, recencyDays: 0.01, sessions30d: -0.01 };
    expect(computeChurn(aggWith({ days_since_last_event: 500 }), c)).toBe(
      computeChurn(aggWith({ days_since_last_event: 180 }), c),
    );
    expect(computeChurn(aggWith({ sessions_30d: 300 }), c)).toBe(
      computeChurn(aggWith({ sessions_30d: 30 }), c),
    );
  });

  it('sin eventos asume 90 días de recencia también con coeficientes propios', () => {
    const onlyRecency = { ...zero, recencyDays: 0.01 };
    expect(computeChurn(aggWith({ days_since_last_event: null }), onlyRecency)).toBe(
      computeChurn(aggWith({ days_since_last_event: 90 }), onlyRecency),
    );
  });

  it('no modifica los coeficientes por omisión', () => {
    const before = { ...CHURN_COEFFICIENTS };
    computeChurn(agg, { ...zero, intercept: 3 });
    expect(CHURN_COEFFICIENTS).toEqual(before);
    expect(computeChurn(agg)).toBe(0.142);
  });
});

describe('RFM', () => {
  it('etiqueta como campeón a quien compra seguido y reciente', () => {
    const events = Array.from({ length: 5 }, (_, i) => ev('purchase', i + 1, 120));
    expect(computeRfm(computeAggregates(events, now)).label).toBe('campeón');
  });

  it('etiqueta como dormido a quien no compra hace meses', () => {
    expect(computeRfm(computeAggregates([ev('purchase', 200, 10)], now)).label).toBe('dormido');
  });
});
