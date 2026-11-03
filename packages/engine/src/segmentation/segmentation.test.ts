import type { Rule } from '@cdp/shared';
import { ruleSchema } from '@cdp/shared';
import { describe, expect, it } from 'vitest';
import { computeAggregates, type EngineEvent } from './aggregates';
import { evaluateRule } from './evaluate';

const now = new Date('2026-11-02T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

const ev = (name: string, d: number, amount?: number): EngineEvent => ({
  category: name === 'purchase' || name === 'refund' ? 'transaction' : 'behavior',
  name,
  occurredAt: daysAgo(d),
  properties: amount === undefined ? {} : { amount },
});

describe('agregados de perfil', () => {
  it('calcula gasto, órdenes y recencias', () => {
    const agg = computeAggregates(
      [ev('purchase', 3, 80), ev('purchase', 10, 40), ev('purchase', 60, 200), ev('refund', 2, 20), ev('app_open', 20)],
      now,
    );
    expect(agg.spend_30d).toBe(100);
    expect(agg.spend_total).toBe(300);
    expect(agg.orders_30d).toBe(2);
    expect(agg.avg_order_value).toBe(106.67);
    expect(agg.days_since_last_purchase).toBe(3);
    expect(agg.days_since_app_open).toBe(20);
  });

  it('deja en null las recencias sin eventos', () => {
    const agg = computeAggregates([], now);
    expect(agg.days_since_last_purchase).toBeNull();
    expect(agg.avg_order_value).toBeNull();
  });
});

describe('evaluación de segmentos', () => {
  // "Gastaron más de $100 USD en el último mes pero no han abierto la app en 14 días"
  const rule: Rule = {
    all: [
      { field: 'spend_30d', op: 'gt', value: 100 },
      { field: 'days_since_app_open', op: 'gte', value: 14 },
    ],
  };

  it('acepta la regla del ejemplo de objetivo.md', () => {
    expect(ruleSchema.safeParse(rule).success).toBe(true);
  });

  it('incluye al cliente que cumple ambas condiciones', () => {
    const agg = computeAggregates([ev('purchase', 5, 150), ev('app_open', 20)], now);
    expect(evaluateRule(rule, agg)).toBe(true);
  });

  it('excluye al que abrió la app hace poco', () => {
    const agg = computeAggregates([ev('purchase', 5, 150), ev('app_open', 2)], now);
    expect(evaluateRule(rule, agg)).toBe(false);
  });

  it('trata un campo nulo como no cumplido, y "not" lo invierte', () => {
    const agg = computeAggregates([ev('purchase', 5, 150)], now);
    expect(evaluateRule(rule, agg)).toBe(false);
    expect(evaluateRule({ not: { field: 'days_since_app_open', op: 'exists' } }, agg)).toBe(true);
  });

  it('soporta grupos "any" anidados', () => {
    const agg = computeAggregates([ev('cart_abandoned', 1)], now);
    const r: Rule = {
      any: [
        { field: 'cart_abandoned_30d', op: 'gte', value: 1 },
        { all: [{ field: 'orders_total', op: 'gt', value: 5 }] },
      ],
    };
    expect(evaluateRule(r, agg)).toBe(true);
  });
});
