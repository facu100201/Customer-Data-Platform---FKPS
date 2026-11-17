/**
 * La conversión al constructor visual (shared/segmentBuilder.ts) no debe cambiar a quién incluye un
 * segmento guardado. Se generan reglas y perfiles al azar (con semilla fija, reproducible) y se
 * compara la evaluación de la regla original contra la que sale de builderToRule(ruleToBuilder(r)).
 */
import {
  builderToRule,
  OPERATORS,
  PROFILE_FIELDS,
  ruleSchema,
  ruleToBuilder,
  type Condition,
  type Rule,
} from '@cdp/shared';
import { describe, expect, it } from 'vitest';
import type { ProfileAggregates } from './aggregates';
import { evaluateRule } from './evaluate';

// Pruebas con miles de casos al azar: el límite de 5 s de Vitest es para pruebas unitarias y, con
// la máquina cargada (CI, varias suites a la vez), estas pueden pasarlo sin que nada esté mal.
const RANDOM_TEST_TIMEOUT = 30_000;

/** mulberry32: PRNG pequeño y determinista */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
// pocos valores para que las igualdades y los límites (gt vs gte) de verdad se ejerciten
const VALUES = [-1, 0, 1, 2, 5, 14, 100];

function randomCondition(r: () => number): Condition {
  const field = pick(r, PROFILE_FIELDS);
  const op = pick(r, OPERATORS);
  if (op !== 'exists') return { field, op, value: pick(r, VALUES) };
  // exists guardado con y sin valor: el valor se ignora al evaluar y el constructor lo descarta
  const v = r();
  return v < 0.6
    ? { field, op }
    : v < 0.8
      ? { field, op, value: null }
      : { field, op, value: pick(r, VALUES) };
}

function randomRule(r: () => number, depth: number): Rule {
  const roll = r();
  if (depth <= 0 || roll < 0.4) return randomCondition(r);
  if (roll < 0.55) return { not: randomRule(r, depth - 1) }; // incluye not doble y not de condición
  const children = Array.from({ length: 1 + Math.floor(r() * 3) }, () => randomRule(r, depth - 1));
  return roll < 0.78 ? { all: children } : { any: children };
}

function randomProfile(r: () => number): ProfileAggregates {
  return Object.fromEntries(
    PROFILE_FIELDS.map((f) => [f, r() < 0.25 ? null : pick(r, VALUES)]),
  ) as ProfileAggregates;
}

describe('constructor visual: ida y vuelta conserva el significado', () => {
  it(
    'evalúa igual que la regla original en 2000 reglas × 50 perfiles al azar',
    () => {
      const r = rng(20261117);
      const profiles = Array.from({ length: 50 }, () => randomProfile(r));

      let checked = 0;
      for (let i = 0; i < 2000; i++) {
        const original = randomRule(r, 4);
        if (!ruleSchema.safeParse(original).success)
          throw new Error(`generó una regla inválida: ${JSON.stringify(original)}`);

        const result = builderToRule(ruleToBuilder(original));
        if (!result.ok)
          throw new Error(`no convirtió ${JSON.stringify(original)}: ${JSON.stringify(result.issues)}`);

        for (const p of profiles) {
          if (evaluateRule(result.rule, p) !== evaluateRule(original, p)) {
            throw new Error(
              `difiere: ${JSON.stringify(original)} -> ${JSON.stringify(result.rule)} con ${JSON.stringify(p)}`,
            );
          }
        }
        // y una segunda vuelta ya no cambia nada (la forma canónica es estable)
        // (sin expect por vuelta: 2000 comparaciones profundas hacen lenta la prueba con la máquina cargada)
        const again = builderToRule(ruleToBuilder(result.rule));
        if (!again.ok || JSON.stringify(again.rule) !== JSON.stringify(result.rule)) {
          throw new Error(`la forma canónica no es estable: ${JSON.stringify(result.rule)}`);
        }
        checked++;
      }
      expect(checked).toBe(2000);
    },
    RANDOM_TEST_TIMEOUT,
  );
});
