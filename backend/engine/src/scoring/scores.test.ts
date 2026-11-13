import { describe, expect, it } from 'vitest';
import { computeAggregates, type EngineEvent } from '../segmentation/aggregates';
import { computeChurn, computeClv, computeRfm } from './scores';

const now = new Date('2026-11-02T12:00:00Z');
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

describe('RFM', () => {
  it('etiqueta como campeón a quien compra seguido y reciente', () => {
    const events = Array.from({ length: 5 }, (_, i) => ev('purchase', i + 1, 120));
    expect(computeRfm(computeAggregates(events, now)).label).toBe('campeón');
  });

  it('etiqueta como dormido a quien no compra hace meses', () => {
    expect(computeRfm(computeAggregates([ev('purchase', 200, 10)], now)).label).toBe('dormido');
  });
});
