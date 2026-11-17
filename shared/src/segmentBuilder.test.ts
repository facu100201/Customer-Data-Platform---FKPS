import { describe, expect, it } from 'vitest';
import {
  appendChild,
  builderToDraftRule,
  builderToRule,
  newCondition,
  newGroup,
  parseRuleJson,
  removeNode,
  ruleToBuilder,
  updateNode,
  type BuilderCondition,
  type BuilderGroup,
  type BuilderNode,
} from './segmentBuilder';
import { OPERATORS, PROFILE_FIELDS, ruleSchema, type Rule } from './segments';

// Pruebas con miles de casos al azar: el límite de 5 s de Vitest es para pruebas unitarias y, con
// la máquina cargada (CI, varias suites a la vez), estas pueden pasarlo sin que nada esté mal.
const RANDOM_TEST_TIMEOUT = 30_000;

/** Ids deterministas: n1, n2, ... por cada conversión. */
const ids = () => {
  let i = 0;
  return { newId: () => `n${++i}` };
};

const cond = (id: string, patch: Partial<BuilderCondition> = {}): BuilderCondition => ({
  kind: 'condition',
  id,
  field: 'spend_30d',
  op: 'gt',
  value: 100,
  negated: false,
  ...patch,
});

const group = (id: string, children: BuilderNode[], patch: Partial<BuilderGroup> = {}): BuilderGroup => ({
  kind: 'group',
  id,
  combinator: 'all',
  negated: false,
  children,
  ...patch,
});

const roundTrip = (rule: Rule) => {
  const result = builderToRule(ruleToBuilder(rule, ids()));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.rule;
};

describe('ruleToBuilder', () => {
  it('convierte el segmento de ejemplo del seed', () => {
    const rule: Rule = {
      all: [
        { field: 'spend_30d', op: 'gt', value: 100 },
        { field: 'days_since_app_open', op: 'gte', value: 14 },
      ],
    };
    expect(ruleToBuilder(rule, ids())).toEqual(
      group('n1', [cond('n2'), cond('n3', { field: 'days_since_app_open', op: 'gte', value: 14 })]),
    );
  });

  it('envuelve una condición suelta en un grupo all', () => {
    expect(ruleToBuilder({ field: 'clv', op: 'gte', value: 500 }, ids())).toEqual(
      group('n2', [cond('n1', { field: 'clv', op: 'gte', value: 500 })]),
    );
  });

  it('pliega "not" en la bandera negated de condiciones y grupos', () => {
    const rule: Rule = {
      not: {
        any: [
          { not: { field: 'days_since_app_open', op: 'exists' } },
          { field: 'churn_score', op: 'gt', value: 0.7 },
        ],
      },
    };
    expect(ruleToBuilder(rule, ids())).toEqual(
      group(
        'n1',
        [
          cond('n2', { field: 'days_since_app_open', op: 'exists', value: null, negated: true }),
          cond('n3', { field: 'churn_score', op: 'gt', value: 0.7 }),
        ],
        { combinator: 'any', negated: true },
      ),
    );
  });

  it('un "not" de una condición en la raíz queda como condición negada dentro de un grupo all', () => {
    expect(ruleToBuilder({ not: { field: 'clv', op: 'exists' } }, ids())).toEqual(
      group('n2', [cond('n1', { field: 'clv', op: 'exists', value: null, negated: true })]),
    );
  });

  it('cancela un "not" doble', () => {
    const tree = ruleToBuilder({ not: { not: { all: [{ field: 'clv', op: 'exists' }] } } }, ids());
    expect(tree.negated).toBe(false);
    const triple = ruleToBuilder({ all: [{ not: { not: { not: { field: 'clv', op: 'exists' } } } }] }, ids());
    expect(triple.children[0]).toMatchObject({ kind: 'condition', negated: true });
  });

  it('conserva grupos anidados a varios niveles', () => {
    const rule: Rule = {
      any: [
        { field: 'cart_abandoned_30d', op: 'gte', value: 1 },
        {
          all: [
            { field: 'orders_total', op: 'gt', value: 5 },
            {
              any: [
                { field: 'clv', op: 'gte', value: 1000 },
                { field: 'spend_total', op: 'gte', value: 2000 },
              ],
            },
          ],
        },
      ],
    };
    const tree = ruleToBuilder(rule, ids());
    expect(tree.combinator).toBe('any');
    const inner = tree.children[1] as BuilderGroup;
    expect(inner).toMatchObject({ kind: 'group', combinator: 'all' });
    expect(inner.children[1]).toMatchObject({ kind: 'group', combinator: 'any' });
    expect((inner.children[1] as BuilderGroup).children).toHaveLength(2);
  });

  it('usa null cuando la condición guardada no trae valor', () => {
    const tree = ruleToBuilder(
      {
        all: [
          { field: 'clv', op: 'exists' },
          { field: 'clv', op: 'gt', value: null },
        ],
      },
      ids(),
    );
    expect(tree.children.map((c) => (c as BuilderCondition).value)).toEqual([null, null]);
  });

  it('genera ids únicos con el generador por defecto', () => {
    const rule: Rule = { all: [{ field: 'clv', op: 'exists' }, { any: [{ field: 'clv', op: 'exists' }] }] };
    const a = ruleToBuilder(rule);
    const b = ruleToBuilder(rule);
    const collect = (n: BuilderNode): string[] =>
      n.kind === 'group' ? [n.id, ...n.children.flatMap(collect)] : [n.id];
    const all = [...collect(a), ...collect(b)];
    expect(new Set(all).size).toBe(all.length);
  });

  it('no modifica la regla de entrada', () => {
    const rule: Rule = { all: [{ not: { field: 'clv', op: 'gt', value: 1 } }] };
    const copy = structuredClone(rule);
    ruleToBuilder(rule);
    expect(rule).toEqual(copy);
  });
});

describe('builderToRule', () => {
  it('produce la regla guardable y válida para la API', () => {
    const tree = group('root', [
      cond('a'),
      group(
        'g',
        [
          cond('b', { field: 'clv', op: 'exists', value: null, negated: true }),
          cond('c', { op: 'lte', value: 0 }),
        ],
        {
          combinator: 'any',
        },
      ),
    ]);
    const result = builderToRule(tree);
    expect(result).toEqual({
      ok: true,
      rule: {
        all: [
          { field: 'spend_30d', op: 'gt', value: 100 },
          {
            any: [{ not: { field: 'clv', op: 'exists' } }, { field: 'spend_30d', op: 'lte', value: 0 }],
          },
        ],
      },
    });
    if (result.ok) expect(ruleSchema.safeParse(result.rule).success).toBe(true);
  });

  it('envuelve en "not" un grupo negado, incluida la raíz', () => {
    expect(builderToRule(group('r', [cond('a')], { negated: true, combinator: 'any' }))).toEqual({
      ok: true,
      rule: { not: { any: [{ field: 'spend_30d', op: 'gt', value: 100 }] } },
    });
  });

  it('descarta el valor de "exists" aunque la interfaz conserve uno', () => {
    expect(builderToRule(group('r', [cond('a', { op: 'exists', value: 50 })]))).toEqual({
      ok: true,
      rule: { all: [{ field: 'spend_30d', op: 'exists' }] },
    });
  });

  it('acepta 0 y negativos como valor', () => {
    const result = builderToRule(group('r', [cond('a', { value: 0 }), cond('b', { value: -5 })]));
    expect(result.ok).toBe(true);
  });

  it('reporta grupos vacíos, incluida la raíz', () => {
    expect(builderToRule(group('r', []))).toEqual({
      ok: false,
      issues: [{ nodeId: 'r', code: 'empty_group', message: expect.any(String) }],
    });
    const nested = builderToRule(group('r', [cond('a'), group('g', [])]));
    expect(nested.ok === false && nested.issues.map((i) => [i.nodeId, i.code])).toEqual([
      ['g', 'empty_group'],
    ]);
  });

  it('reporta comparaciones sin valor o con valor no numérico', () => {
    const result = builderToRule(
      group('r', [
        cond('a', { value: null }),
        cond('b', { value: Number.NaN }),
        cond('c', { value: Number.POSITIVE_INFINITY }),
        cond('d', { value: '5' as unknown as number }),
      ]),
    );
    expect(result.ok === false && result.issues.map((i) => [i.nodeId, i.code])).toEqual([
      ['a', 'missing_value'],
      ['b', 'invalid_value'],
      ['c', 'invalid_value'],
      ['d', 'invalid_value'],
    ]);
  });

  it('reporta campos, operadores y combinadores desconocidos', () => {
    const result = builderToRule(
      group('r', [cond('a', { field: 'email' as never }), cond('b', { op: 'contains' as never })], {
        combinator: 'none' as never,
      }),
    );
    expect(result.ok === false && result.issues.map((i) => [i.nodeId, i.code])).toEqual([
      ['a', 'unknown_field'],
      ['b', 'unknown_operator'],
      ['r', 'unknown_combinator'],
    ]);
  });

  it('junta todos los problemas del árbol, no solo el primero', () => {
    const result = builderToRule(
      group('r', [cond('a', { value: null }), group('g', [cond('b', { value: null })]), group('h', [])]),
    );
    expect(result.ok === false && result.issues.map((i) => i.nodeId)).toEqual(['a', 'b', 'h']);
  });
});

describe('ida y vuelta', () => {
  it.each<[string, Rule]>([
    [
      'segmento del seed',
      {
        all: [
          { field: 'spend_30d', op: 'gt', value: 100 },
          { field: 'days_since_app_open', op: 'gte', value: 14 },
        ],
      },
    ],
    [
      'any con exists negado',
      {
        any: [{ not: { field: 'days_since_app_open', op: 'exists' } }, { field: 'clv', op: 'lt', value: 10 }],
      },
    ],
    ['raíz negada', { not: { all: [{ field: 'orders_30d', op: 'eq', value: 0 }] } }],
    [
      'anidado profundo',
      {
        any: [
          { field: 'cart_abandoned_30d', op: 'gte', value: 1 },
          {
            all: [
              { field: 'orders_total', op: 'gt', value: 5 },
              {
                not: {
                  any: [
                    { field: 'churn_score', op: 'gte', value: 0.5 },
                    { all: [{ field: 'sessions_30d', op: 'neq', value: 3 }] },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  ])('devuelve la misma regla cuando ya es canónica: %s', (_name, rule) => {
    expect(roundTrip(rule)).toEqual(rule);
  });

  it('normaliza las formas no canónicas sin cambiar el significado', () => {
    // condición suelta en la raíz -> grupo all de un elemento
    expect(roundTrip({ field: 'clv', op: 'gt', value: 1 })).toEqual({
      all: [{ field: 'clv', op: 'gt', value: 1 }],
    });
    // not doble -> se cancela
    expect(roundTrip({ not: { not: { any: [{ field: 'clv', op: 'exists' }] } } })).toEqual({
      any: [{ field: 'clv', op: 'exists' }],
    });
    // exists con valor guardado -> sin valor (evaluate lo ignora)
    expect(roundTrip({ all: [{ field: 'clv', op: 'exists', value: 3 }] })).toEqual({
      all: [{ field: 'clv', op: 'exists' }],
    });
    expect(roundTrip({ all: [{ field: 'clv', op: 'exists', value: null }] })).toEqual({
      all: [{ field: 'clv', op: 'exists' }],
    });
  });

  it('una comparación guardada sin valor se carga, pero no se vuelve a guardar sin corregirla', () => {
    const tree = ruleToBuilder({ all: [{ field: 'clv', op: 'gt' }] }, ids());
    expect(builderToRule(tree)).toMatchObject({
      ok: false,
      issues: [{ nodeId: 'n2', code: 'missing_value' }],
    });
  });
});

describe('edición del árbol', () => {
  const tree = () =>
    group('r', [cond('a'), group('g', [cond('b'), group('h', [cond('c')])], { combinator: 'any' })]);

  it('newCondition arranca sin valor y queda marcada como incompleta', () => {
    const c = newCondition(ids());
    expect(c).toEqual({
      kind: 'condition',
      id: 'n1',
      field: 'spend_total',
      op: 'gt',
      value: null,
      negated: false,
    });
    expect(builderToRule(group('r', [c]))).toMatchObject({
      ok: false,
      issues: [{ nodeId: 'n1', code: 'missing_value' }],
    });
  });

  it('newGroup trae una condición vacía para no quedar como grupo vacío', () => {
    expect(newGroup('any', ids())).toEqual(
      group('n1', [cond('n2', { field: 'spend_total', value: null })], { combinator: 'any' }),
    );
  });

  it('updateNode cambia solo el nodo indicado y comparte lo demás', () => {
    const before = tree();
    const after = updateNode(before, 'c', (n) => ({ ...n, negated: true }));
    const g = after.children[1] as BuilderGroup;
    expect((g.children[1] as BuilderGroup).children[0]).toMatchObject({ id: 'c', negated: true });
    expect(after.children[0]).toBe(before.children[0]); // rama sin cambios: misma referencia
    expect(g.children[0]).toBe((before.children[1] as BuilderGroup).children[0]);
    expect(before).toEqual(tree()); // no muta el original
  });

  it('updateNode puede cambiar la raíz, pero no convertirla en condición', () => {
    expect(updateNode(tree(), 'r', (n) => ({ ...n, negated: true })).negated).toBe(true);
    const root = tree();
    expect(updateNode(root, 'r', () => cond('x'))).toBe(root);
  });

  it('updateNode con un id inexistente devuelve el mismo árbol', () => {
    const root = tree();
    expect(updateNode(root, 'nada', (n) => ({ ...n, negated: true }))).toBe(root);
  });

  it('removeNode quita condiciones y grupos completos a cualquier profundidad', () => {
    expect(builderToRule(removeNode(tree(), 'c'))).toMatchObject({
      ok: false,
      issues: [{ nodeId: 'h', code: 'empty_group' }],
    });
    const sinG = removeNode(tree(), 'g');
    expect(sinG.children.map((n) => n.id)).toEqual(['a']);
  });

  it('removeNode no quita la raíz y no cambia nada si el id no existe', () => {
    const root = tree();
    expect(removeNode(root, 'r')).toBe(root);
    expect(removeNode(root, 'nada')).toBe(root);
  });

  it('appendChild agrega al final del grupo y no agrega dentro de una condición', () => {
    const added = appendChild(tree(), 'h', cond('z'));
    const h = (added.children[1] as BuilderGroup).children[1] as BuilderGroup;
    expect(h.children.map((n) => n.id)).toEqual(['c', 'z']);
    const root = tree();
    expect(appendChild(root, 'a', cond('z'))).toBe(root);
  });

  it('una sesión de edición completa produce la regla esperada', () => {
    const gen = ids();
    let t = ruleToBuilder({ all: [{ field: 'spend_30d', op: 'gt', value: 100 }] }, gen); // n1 raíz, n2 condición
    t = appendChild(t, 'n1', newGroup('any', gen)); // n3 grupo, n4 condición
    t = updateNode(t, 'n4', (n) => ({ ...n, field: 'days_since_app_open', op: 'exists', negated: true }));
    t = appendChild(t, 'n3', newCondition(gen)); // n5
    t = updateNode(t, 'n5', (n) => ({ ...n, field: 'churn_score', op: 'gte', value: 0.7 }));
    expect(builderToRule(t)).toEqual({
      ok: true,
      rule: {
        all: [
          { field: 'spend_30d', op: 'gt', value: 100 },
          {
            any: [
              { not: { field: 'days_since_app_open', op: 'exists' } },
              { field: 'churn_score', op: 'gte', value: 0.7 },
            ],
          },
        ],
      },
    });
  });
});

describe('builderToDraftRule (modo JSON)', () => {
  it('muestra la regla aunque esté incompleta', () => {
    const t = group('r', [cond('a', { value: null }), group('g', [], { combinator: 'any', negated: true })]);
    expect(builderToDraftRule(t)).toEqual({
      all: [{ field: 'spend_30d', op: 'gt', value: null }, { not: { any: [] } }],
    });
  });

  it('con la regla completa coincide con lo que se guarda', () => {
    const t = group('r', [cond('a'), cond('b', { op: 'exists', value: 3, negated: true })]);
    const saved = builderToRule(t);
    expect(saved.ok && saved.rule).toEqual(builderToDraftRule(t));
  });
});

describe('parseRuleJson', () => {
  it('lee una regla válida tal cual', () => {
    const rule: Rule = {
      any: [{ not: { field: 'clv', op: 'exists' } }, { all: [{ field: 'spend_30d', op: 'gt', value: 100 }] }],
    };
    expect(parseRuleJson(JSON.stringify(rule, null, 2))).toEqual({ ok: true, rule });
  });

  it('conserva value: null y la ausencia de value', () => {
    const r = parseRuleJson('{"all":[{"field":"clv","op":"gt","value":null},{"field":"clv","op":"exists"}]}');
    expect(r).toEqual({
      ok: true,
      rule: {
        all: [
          { field: 'clv', op: 'gt', value: null },
          { field: 'clv', op: 'exists' },
        ],
      },
    });
  });

  it('acepta reglas incompletas para que el constructor las marque', () => {
    const r = parseRuleJson('{"all":[]}');
    expect(r).toEqual({ ok: true, rule: { all: [] } });
    if (r.ok)
      expect(builderToRule(ruleToBuilder(r.rule, ids()))).toMatchObject({
        ok: false,
        issues: [{ code: 'empty_group' }],
      });
  });

  it.each<[string, string, RegExp]>([
    ['sintaxis', '{"all": [', /^El JSON está mal formado: /],
    ['vacío', '', /^El JSON está mal formado: /],
    ['raíz que no es objeto', '[]', /^En la raíz: se esperaba un objeto y hay una lista\.$/],
    ['número en la raíz', '5', /^En la raíz: se esperaba un objeto y hay 5\.$/],
    ['objeto vacío', '{}', /^En la raíz: se esperaba una condición/],
    [
      'grupo que no es lista',
      '{"any": {"field":"clv","op":"exists"}}',
      /^En any: se esperaba una lista de condiciones/,
    ],
    [
      'campo desconocido',
      '{"all":[{"field":"email","op":"eq","value":1}]}',
      /^En all\[0\]: "email" no es un campo del perfil\. Campos: spend_total, /,
    ],
    [
      'operador desconocido',
      '{"all":[{"field":"clv","op":"contains","value":1}]}',
      /^En all\[0\]: "contains" no es un operador\./,
    ],
    [
      'valor texto',
      '{"all":[{"field":"clv","op":"gt","value":"100"}]}',
      /^En all\[0\]: "value" debe ser un número o null y hay "100"\.$/,
    ],
    [
      'valor infinito',
      '{"all":[{"field":"clv","op":"gt","value":1e999}]}',
      /^En all\[0\]: "value" debe ser un número o null y hay Infinity\.$/,
    ],
    ['falta op', '{"field":"clv"}', /^En la raíz: falta "op"\.$/],
    ['falta field', '{"op":"exists"}', /^En la raíz: falta "field"\.$/],
    ['llave de más en condición', '{"field":"clv","op":"exists","valor":1}', /^En la raíz: sobra "valor"/],
    ['all y any juntos', '{"all":[],"any":[]}', /^En la raíz: sobra "any"/],
    [
      'ruta anidada',
      '{"any":[{"not":{"all":[{"field":"clv","op":"exists"},{"field":"x","op":"gt"}]}}]}',
      /^En any\[0\]\.not\.all\[1\]: "x" no es un campo/,
    ],
    [
      '__proto__ no cuenta como campo',
      '{"__proto__":{"field":"clv","op":"exists"}}',
      /^En la raíz: se esperaba una condición/,
    ],
  ])('rechaza: %s', (_name, text, message) => {
    const r = parseRuleJson(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(message);
  });

  it('una anidación absurda da error, no rompe la página', () => {
    const deep = '{"not":'.repeat(20_000) + '{"field":"clv","op":"exists"}' + '}'.repeat(20_000);
    const r = parseRuleJson(deep);
    // o la lee (si la pila alcanza) o avisa; nunca lanza
    if (!r.ok) expect(r.message).toMatch(/anidación|mal formado/);
  });
});

describe('parseRuleJson y ruleSchema aceptan lo mismo', () => {
  // PRNG con semilla fija (mulberry32) para que las pruebas sean reproducibles
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = rng(42);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

  const randomRule = (depth: number): Rule => {
    const roll = r();
    if (depth <= 0 || roll < 0.4) {
      const op = pick(OPERATORS);
      const v = r();
      const base = { field: pick(PROFILE_FIELDS), op };
      return v < 0.2
        ? base
        : v < 0.3
          ? { ...base, value: null }
          : { ...base, value: Math.round(r() * 200) - 50 };
    }
    if (roll < 0.55) return { not: randomRule(depth - 1) };
    const children = Array.from({ length: 1 + Math.floor(r() * 3) }, () => randomRule(depth - 1));
    return roll < 0.78 ? { all: children } : { any: children };
  };

  /** Rompe un nodo al azar de la regla de alguna de las formas en que se equivoca una persona. */
  const mutate = (value: unknown): unknown => {
    const nodes: Record<string, unknown>[] = [];
    const walk = (v: unknown) => {
      if (typeof v !== 'object' || v === null) return;
      if (Array.isArray(v)) return v.forEach(walk);
      nodes.push(v as Record<string, unknown>);
      Object.values(v).forEach(walk);
    };
    walk(value);
    const n = pick(nodes);
    const bad: (() => void)[] = [
      () => (n.extra = 1),
      () => ('field' in n ? (n.field = 'email') : (n.all = [])),
      () => ('op' in n ? (n.op = 'contains') : (n.any = 'x')),
      () => ('field' in n ? (n.value = '5') : delete n[Object.keys(n)[0]!]),
      () => ('field' in n ? delete n.op : (n.not = [])),
      () => ('all' in n ? (n.all = []) : 'any' in n ? (n.any = []) : (n.value = null)),
    ];
    pick(bad)();
    return value;
  };

  /** Grupos vacíos: lo único que parseRuleJson acepta de más (a propósito) */
  const hasEmptyGroup = (v: unknown): boolean =>
    typeof v === 'object' &&
    v !== null &&
    (Array.isArray(v)
      ? v.some(hasEmptyGroup)
      : ['all', 'any'].some(
          (k) =>
            Array.isArray((v as Record<string, unknown>)[k]) &&
            ((v as Record<string, unknown>)[k] as unknown[]).length === 0,
        ) || Object.values(v).some(hasEmptyGroup));

  it(
    'toda regla válida se lee igual, y al revés',
    () => {
      // Se juntan las diferencias y se compara una vez al final: un expect por vuelta hace la prueba
      // lenta y, con la máquina cargada, puede pasar del tiempo límite de 5 s.
      const wrong: unknown[] = [];
      for (let i = 0; i < 1000; i++) {
        const rule = randomRule(4);
        const text = JSON.stringify(rule);
        const parsed = parseRuleJson(text);
        if (!parsed.ok || JSON.stringify(parsed.rule) !== text) wrong.push(rule);
      }
      expect(wrong).toEqual([]);
    },
    RANDOM_TEST_TIMEOUT,
  );

  it(
    'con reglas dañadas al azar coinciden, salvo los grupos vacíos',
    () => {
      let rejected = 0;
      const disagree: unknown[] = [];
      for (let i = 0; i < 2000; i++) {
        const json = mutate(structuredClone(randomRule(4)));
        const parsed = parseRuleJson(JSON.stringify(json));
        const schema = ruleSchema.safeParse(json).success;
        // con grupos vacíos basta que lo que el esquema acepta, el lector también lo acepte
        const agree = hasEmptyGroup(json) ? !schema || parsed.ok : parsed.ok === schema;
        if (!agree) disagree.push({ json, parser: parsed.ok, schema });
        if (!parsed.ok) rejected++;
      }
      expect(disagree).toEqual([]);
      expect(rejected).toBeGreaterThan(500); // las mutaciones sí producen reglas inválidas
    },
    RANDOM_TEST_TIMEOUT,
  );
});

describe('sincronía constructor ⇄ JSON', () => {
  it('constructor → JSON → constructor da la misma regla y los mismos avisos', () => {
    const trees = [
      group('r', [
        cond('a'),
        group('g', [cond('b', { op: 'exists', negated: true })], { combinator: 'any' }),
      ]),
      group('r', [cond('a', { value: null }), group('g', [])], { negated: true }),
      group('r', []),
    ];
    for (const t of trees) {
      const parsed = parseRuleJson(JSON.stringify(builderToDraftRule(t)));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const back = ruleToBuilder(parsed.rule);
      const a = builderToRule(t);
      const b = builderToRule(back);
      expect(b.ok).toBe(a.ok);
      if (a.ok && b.ok) expect(b.rule).toEqual(a.rule);
      if (!a.ok && !b.ok) expect(b.issues.map((i) => i.code)).toEqual(a.issues.map((i) => i.code));
    }
  });
});
