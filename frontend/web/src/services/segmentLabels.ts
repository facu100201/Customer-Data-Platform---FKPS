import type { Combinator, Operator, ProfileField } from '@cdp/shared';

/** Etiquetas en español de los campos del perfil. `Record` obliga a etiquetar cualquier campo nuevo. */
export const FIELD_LABELS: Record<ProfileField, string> = {
  spend_total: 'Gasto total (MXN)',
  spend_30d: 'Gasto en los últimos 30 días (MXN)',
  orders_total: 'Órdenes totales',
  orders_30d: 'Órdenes en los últimos 30 días',
  avg_order_value: 'Ticket promedio (MXN)',
  sessions_30d: 'Sesiones en los últimos 30 días',
  cart_abandoned_30d: 'Carritos abandonados en los últimos 30 días',
  support_tickets_30d: 'Tickets de soporte en los últimos 30 días',
  days_since_last_event: 'Días desde su última actividad',
  days_since_last_purchase: 'Días desde su última compra',
  days_since_app_open: 'Días desde que abrió la app',
  clv: 'Valor de vida del cliente, CLV (MXN)',
  churn_score: 'Riesgo de churn (de 0 a 1)',
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: 'es igual a',
  neq: 'es distinto de',
  gt: 'es mayor que',
  gte: 'es mayor o igual a',
  lt: 'es menor que',
  lte: 'es menor o igual a',
  exists: 'tiene valor',
};

export const COMBINATOR_LABELS: Record<Combinator, string> = {
  all: 'todas estas condiciones',
  any: 'al menos una de estas condiciones',
};
