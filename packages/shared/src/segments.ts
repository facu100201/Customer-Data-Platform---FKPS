import { z } from 'zod';

export const PROFILE_FIELDS = [
  'spend_total',
  'spend_30d',
  'orders_total',
  'orders_30d',
  'avg_order_value',
  'sessions_30d',
  'cart_abandoned_30d',
  'support_tickets_30d',
  'days_since_last_event',
  'days_since_last_purchase',
  'days_since_app_open',
  'clv',
  'churn_score',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists'] as const;
export type Operator = (typeof OPERATORS)[number];

export type Condition = { field: ProfileField; op: Operator; value?: number | null };
export type RuleGroup = { all: Rule[] } | { any: Rule[] } | { not: Rule };
export type Rule = Condition | RuleGroup;

const conditionSchema = z
  .object({ field: z.enum(PROFILE_FIELDS), op: z.enum(OPERATORS), value: z.number().nullable().optional() })
  .strict();

export const ruleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    conditionSchema,
    z.object({ all: z.array(ruleSchema).min(1) }).strict(),
    z.object({ any: z.array(ruleSchema).min(1) }).strict(),
    z.object({ not: ruleSchema }).strict(),
  ]),
);

export const segmentInputSchema = z.object({
  name: z.string().min(3).max(80),
  description: z.string().max(500).optional(),
  definition: ruleSchema,
});
export type SegmentInput = z.infer<typeof segmentInputSchema>;
