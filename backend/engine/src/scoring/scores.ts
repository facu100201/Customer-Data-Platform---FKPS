import type { ProfileAggregates } from '../segmentation/aggregates';

export type ClvParams = {
  /** Vida esperada del cliente en meses. */
  lifespanMonths: number;
  /** Margen bruto 0–1. */
  margin: number;
};

export const DEFAULT_CLV: ClvParams = { lifespanMonths: 24, margin: 0.3 };

/**
 * CLV = ticket promedio × compras por mes × vida esperada × margen.
 * La frecuencia mensual sale de las compras de los últimos 30 días; si no hay, del total repartido
 * en la antigüedad del cliente.
 */
export function computeClv(
  agg: ProfileAggregates,
  tenureDays: number,
  params: ClvParams = DEFAULT_CLV,
): number {
  const aov = agg.avg_order_value ?? 0;
  if (aov <= 0) return 0;
  const orders30 = agg.orders_30d ?? 0;
  const monthlyFreq = orders30 > 0 ? orders30 : (agg.orders_total ?? 0) / Math.max(1, tenureDays / 30);
  return Math.round(aov * monthlyFreq * params.lifespanMonths * params.margin * 100) / 100;
}

/** Coeficientes del modelo logístico de churn (ver docs/modelo-matematico.md). */
export const CHURN_COEFFICIENTS = {
  intercept: -2.0,
  recencyDays: 0.08,
  orders30d: -0.6,
  sessions30d: -0.15,
  tickets30d: 0.35,
  cartAbandoned30d: 0.2,
} as const;

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Probabilidad 0–1 de abandono basada en recencia, frecuencia y fricción. */
export function computeChurn(agg: ProfileAggregates): number {
  const c = CHURN_COEFFICIENTS;
  const recency = Math.min(agg.days_since_last_event ?? 90, 180);
  const z =
    c.intercept +
    c.recencyDays * recency +
    c.orders30d * (agg.orders_30d ?? 0) +
    c.sessions30d * Math.min(agg.sessions_30d ?? 0, 30) +
    c.tickets30d * (agg.support_tickets_30d ?? 0) +
    c.cartAbandoned30d * (agg.cart_abandoned_30d ?? 0);
  return Math.round(sigmoid(z) * 1000) / 1000;
}

export type RfmScore = { r: number; f: number; m: number; label: string };

const bucket = (v: number, cuts: number[]) => 1 + cuts.filter((cut) => v >= cut).length;

/** Puntajes RFM 1–5 con cortes fijos, calibrados para el volumen del simulador. */
export function computeRfm(agg: ProfileAggregates): RfmScore {
  const r = 6 - bucket(agg.days_since_last_purchase ?? 999, [7, 30, 60, 120]);
  const f = bucket(agg.orders_total ?? 0, [1, 2, 4, 8]);
  const m = bucket(agg.spend_total ?? 0, [1, 50, 150, 500]);
  let label = 'regular';
  if (r >= 4 && f >= 4) label = 'campeón';
  else if (r >= 4) label = 'reciente';
  else if (r <= 2 && f >= 3) label = 'en riesgo';
  else if (r <= 2) label = 'dormido';
  return { r, f, m, label };
}
