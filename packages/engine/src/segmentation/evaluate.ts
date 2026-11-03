import type { Condition, Rule } from '@cdp/shared';
import type { ProfileAggregates } from './aggregates';

function evalCondition(c: Condition, profile: ProfileAggregates): boolean {
  const actual = profile[c.field];
  if (c.op === 'exists') return actual !== null && actual !== undefined;
  // un campo nulo nunca cumple una comparación: "gastó > 100" es falso si nunca compró
  if (actual === null || actual === undefined || c.value === null || c.value === undefined) return false;
  switch (c.op) {
    case 'eq':
      return actual === c.value;
    case 'neq':
      return actual !== c.value;
    case 'gt':
      return actual > c.value;
    case 'gte':
      return actual >= c.value;
    case 'lt':
      return actual < c.value;
    case 'lte':
      return actual <= c.value;
  }
}

export function evaluateRule(rule: Rule, profile: ProfileAggregates): boolean {
  if ('all' in rule) return rule.all.every((r) => evaluateRule(r, profile));
  if ('any' in rule) return rule.any.some((r) => evaluateRule(r, profile));
  if ('not' in rule) return !evaluateRule(rule.not, profile);
  return evalCondition(rule, profile);
}

export function filterSegment<T extends { aggregates: ProfileAggregates }>(rule: Rule, profiles: T[]): T[] {
  return profiles.filter((p) => evaluateRule(rule, p.aggregates));
}
