import type { EventCategory, ProfileField } from '@cdp/shared';

export type EngineEvent = {
  category: EventCategory;
  name: string;
  occurredAt: Date;
  properties: Record<string, string | number | boolean | null>;
};

export type ProfileAggregates = Record<ProfileField, number | null>;

const DAY = 86_400_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

const daysSince = (date: Date | undefined, now: Date) =>
  date ? Math.floor((now.getTime() - date.getTime()) / DAY) : null;

const amountOf = (e: EngineEvent) => (typeof e.properties.amount === 'number' ? e.properties.amount : 0);

const sumAmount = (events: EngineEvent[], name: string) =>
  events.filter((e) => e.name === name).reduce((s, e) => s + amountOf(e), 0);

/** Calcula los campos que usan los segmentos a partir del historial de eventos de un perfil. */
export function computeAggregates(
  events: EngineEvent[],
  now: Date,
  scores: { clv?: number | null; churnScore?: number | null } = {},
): ProfileAggregates {
  const since30 = now.getTime() - 30 * DAY;
  const latest = (pred: (e: EngineEvent) => boolean) =>
    events
      .filter(pred)
      .reduce<Date | undefined>((max, e) => (!max || e.occurredAt > max ? e.occurredAt : max), undefined);

  const purchases = events.filter((e) => e.name === 'purchase');
  const recent = events.filter((e) => e.occurredAt.getTime() >= since30);
  const recentPurchases = recent.filter((e) => e.name === 'purchase');
  const spendTotal = sumAmount(events, 'purchase') - sumAmount(events, 'refund');

  return {
    spend_total: round2(spendTotal),
    spend_30d: round2(sumAmount(recent, 'purchase') - sumAmount(recent, 'refund')),
    orders_total: purchases.length,
    orders_30d: recentPurchases.length,
    avg_order_value: purchases.length ? round2(sumAmount(events, 'purchase') / purchases.length) : null,
    sessions_30d: recent.filter((e) => e.name === 'page_view' || e.name === 'app_open').length,
    cart_abandoned_30d: recent.filter((e) => e.name === 'cart_abandoned').length,
    support_tickets_30d: recent.filter((e) => e.name === 'support_ticket').length,
    days_since_last_event: daysSince(
      latest(() => true),
      now,
    ),
    days_since_last_purchase: daysSince(
      latest((e) => e.name === 'purchase'),
      now,
    ),
    days_since_app_open: daysSince(
      latest((e) => e.name === 'app_open'),
      now,
    ),
    clv: scores.clv ?? null,
    churn_score: scores.churnScore ?? null,
  };
}
