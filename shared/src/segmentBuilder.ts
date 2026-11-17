/**
 * Modelo del constructor visual de segmentos y su conversión desde y hacia `Rule`.
 *
 * El formato `Rule` (segments.ts) es el que se guarda en la base y no cambia. El constructor usa un
 * árbol más cómodo para editar: cada nodo tiene un `id` estable (para llaves de React y para señalar
 * errores), los grupos tienen un `combinator` all/any explícito, y `not` se representa con la bandera
 * `negated` en el nodo al que afecta.
 *
 * Garantías:
 * - `ruleToBuilder` acepta cualquier `Rule` válida (incluidas las ya guardadas) sin perder significado.
 * - `builderToRule(ruleToBuilder(r))` evalúa exactamente igual que `r` para cualquier perfil. Para
 *   reglas en forma canónica (raíz all/any, sin `not` doble, `exists` sin `value`) devuelve la
 *   misma regla.
 * - `builderToRule` solo devuelve reglas que pasan `ruleSchema`; si el árbol está incompleto
 *   devuelve la lista de problemas por nodo en lugar de una regla.
 */
import {
  OPERATORS,
  PROFILE_FIELDS,
  ruleSchema,
  type Condition,
  type Operator,
  type ProfileField,
  type Rule,
} from './segments';

export type Combinator = 'all' | 'any';

export type BuilderCondition = {
  kind: 'condition';
  id: string;
  field: ProfileField;
  op: Operator;
  /** null = sin valor capturado. Se ignora con `exists`. */
  value: number | null;
  /** true = la condición va envuelta en `not`. */
  negated: boolean;
};

export type BuilderGroup = {
  kind: 'group';
  id: string;
  combinator: Combinator;
  /** true = el grupo va envuelto en `not`. */
  negated: boolean;
  children: BuilderNode[];
};

export type BuilderNode = BuilderCondition | BuilderGroup;

export type BuilderIssueCode =
  | 'empty_group'
  | 'missing_value'
  | 'invalid_value'
  | 'unknown_field'
  | 'unknown_operator'
  | 'unknown_combinator';

export type BuilderIssue = { nodeId: string; code: BuilderIssueCode; message: string };

export type BuilderToRuleResult = { ok: true; rule: Rule } | { ok: false; issues: BuilderIssue[] };

export type IdOptions = { newId?: () => string };

// Un contador basta para llaves de React y es determinista en pruebas. No se usa crypto.randomUUID
// porque el navegador solo lo expone en contextos seguros (HTTPS), y la web se sirve por ZeroTier.
let seq = 0;
const defaultId = () => `n${++seq}`;

/** Operadores que comparan contra `value` (todos menos `exists`). */
export const operatorNeedsValue = (op: Operator): boolean => op !== 'exists';

// ---------------------------------------------------------------------------------------------
// Rule -> constructor
// ---------------------------------------------------------------------------------------------

/**
 * Convierte una regla guardada en el árbol del constructor. La raíz siempre es un grupo: si la regla
 * guardada es una condición suelta (o un `not` de una condición) se envuelve en un grupo `all`, que
 * evalúa igual.
 */
export function ruleToBuilder(rule: Rule, options: IdOptions = {}): BuilderGroup {
  const newId = options.newId ?? defaultId;
  const node = toNode(rule, false, newId);
  if (node.kind === 'group') return node;
  return { kind: 'group', id: newId(), combinator: 'all', negated: false, children: [node] };
}

function toNode(rule: Rule, negated: boolean, newId: () => string): BuilderNode {
  // `not` se pliega en la bandera del nodo interior; un `not` doble se cancela
  if ('not' in rule) return toNode(rule.not, !negated, newId);
  if ('all' in rule) return toGroup('all', rule.all, negated, newId);
  if ('any' in rule) return toGroup('any', rule.any, negated, newId);
  return {
    kind: 'condition',
    id: newId(),
    field: rule.field,
    op: rule.op,
    value: rule.value ?? null,
    negated,
  };
}

function toGroup(combinator: Combinator, rules: Rule[], negated: boolean, newId: () => string): BuilderGroup {
  // el id del grupo se pide antes que los de sus hijos: orden de documento, más fácil de depurar
  const id = newId();
  return { kind: 'group', id, combinator, negated, children: rules.map((r) => toNode(r, false, newId)) };
}

// ---------------------------------------------------------------------------------------------
// Constructor -> Rule
// ---------------------------------------------------------------------------------------------

/**
 * Convierte el árbol del constructor en la regla que se guarda. No corrige nada por su cuenta: si hay
 * grupos vacíos, comparaciones sin valor o campos desconocidos, devuelve todos los problemas
 * encontrados (con el id del nodo) para que la interfaz los señale.
 */
export function builderToRule(root: BuilderGroup): BuilderToRuleResult {
  const issues: BuilderIssue[] = [];
  const rule = fromNode(root, issues);
  if (issues.length > 0) return { ok: false, issues };

  // Red de seguridad: lo que sale del constructor siempre debe ser aceptado por la API.
  const check = ruleSchema.safeParse(rule);
  if (!check.success) {
    return {
      ok: false,
      issues: [
        {
          nodeId: root.id,
          code: 'invalid_value',
          message: check.error.issues[0]?.message ?? 'Regla inválida',
        },
      ],
    };
  }
  return { ok: true, rule: check.data };
}

/**
 * La regla tal como está en el constructor, aunque esté incompleta: una comparación sin valor sale
 * con `value: null` y un grupo vacío como `{ all: [] }`. Sirve para mostrarla en el modo JSON; para
 * guardar se usa `builderToRule`, que sí exige que esté completa.
 */
export function builderToDraftRule(root: BuilderGroup): Rule {
  return fromNode(root, []);
}

function fromNode(node: BuilderNode, issues: BuilderIssue[]): Rule {
  const inner = node.kind === 'group' ? fromGroup(node, issues) : fromCondition(node, issues);
  return node.negated ? { not: inner } : inner;
}

function fromGroup(group: BuilderGroup, issues: BuilderIssue[]): Rule {
  if (group.children.length === 0) {
    issues.push({ nodeId: group.id, code: 'empty_group', message: 'El grupo no tiene condiciones.' });
  }
  const children = group.children.map((child) => fromNode(child, issues));
  if (group.combinator === 'all') return { all: children };
  if (group.combinator === 'any') return { any: children };
  issues.push({
    nodeId: group.id,
    code: 'unknown_combinator',
    message: `Tipo de grupo desconocido: ${String(group.combinator)}.`,
  });
  return { all: children };
}

function fromCondition(c: BuilderCondition, issues: BuilderIssue[]): Condition {
  // El estado de la interfaz viene de <select> e <input>: se revisa aunque el tipo ya lo restrinja.
  if (!(PROFILE_FIELDS as readonly string[]).includes(c.field)) {
    issues.push({ nodeId: c.id, code: 'unknown_field', message: `Campo desconocido: ${String(c.field)}.` });
  }
  if (!(OPERATORS as readonly string[]).includes(c.op)) {
    issues.push({
      nodeId: c.id,
      code: 'unknown_operator',
      message: `Operador desconocido: ${String(c.op)}.`,
    });
  }
  // `exists` no usa valor: no se guarda aunque la interfaz conserve uno de antes
  if (!operatorNeedsValue(c.op)) return { field: c.field, op: c.op };

  if (c.value === null || c.value === undefined) {
    // La API aceptaría la comparación sin valor, pero nunca cumpliría: casi siempre es un descuido.
    issues.push({ nodeId: c.id, code: 'missing_value', message: 'Falta el valor de la condición.' });
  } else if (typeof c.value !== 'number' || !Number.isFinite(c.value)) {
    issues.push({ nodeId: c.id, code: 'invalid_value', message: 'El valor debe ser un número.' });
  }
  return { field: c.field, op: c.op, value: c.value };
}

// ---------------------------------------------------------------------------------------------
// Edición del árbol (funciones puras: devuelven un árbol nuevo y comparten lo que no cambió)
// ---------------------------------------------------------------------------------------------

/** Condición nueva sin valor: la interfaz la marca como incompleta hasta que se capture uno. */
export function newCondition(options: IdOptions = {}): BuilderCondition {
  const newId = options.newId ?? defaultId;
  return { kind: 'condition', id: newId(), field: PROFILE_FIELDS[0], op: 'gt', value: null, negated: false };
}

/** Grupo nuevo con una condición vacía, para que nunca aparezca un grupo sin nada que editar. */
export function newGroup(combinator: Combinator = 'all', options: IdOptions = {}): BuilderGroup {
  const newId = options.newId ?? defaultId;
  const id = newId();
  return { kind: 'group', id, combinator, negated: false, children: [newCondition({ newId })] };
}

/** Aplica `fn` al nodo con ese id. Si no existe, devuelve el mismo árbol. */
export function updateNode(
  root: BuilderGroup,
  id: string,
  fn: (node: BuilderNode) => BuilderNode,
): BuilderGroup {
  const next = mapNode(root, id, fn);
  // la raíz siempre debe seguir siendo un grupo
  return next.kind === 'group' ? next : root;
}

function mapNode(node: BuilderNode, id: string, fn: (node: BuilderNode) => BuilderNode): BuilderNode {
  if (node.id === id) return fn(node);
  if (node.kind === 'condition') return node;
  let changed = false;
  const children = node.children.map((child) => {
    const next = mapNode(child, id, fn);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/** Quita un nodo (y todo lo que contiene). La raíz no se puede quitar. */
export function removeNode(root: BuilderGroup, id: string): BuilderGroup {
  if (root.id === id) return root;
  return pruneNode(root, id);
}

function pruneNode(group: BuilderGroup, id: string): BuilderGroup {
  const kept = group.children.filter((c) => c.id !== id);
  let changed = kept.length !== group.children.length;
  const children = kept.map((child) => {
    if (child.kind === 'condition') return child;
    const next = pruneNode(child, id);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...group, children } : group;
}

/** Agrega `child` al final del grupo `groupId`. Si el id no es de un grupo, no cambia nada. */
export function appendChild(root: BuilderGroup, groupId: string, child: BuilderNode): BuilderGroup {
  return updateNode(root, groupId, (node) =>
    node.kind === 'group' ? { ...node, children: [...node.children, child] } : node,
  );
}

// ---------------------------------------------------------------------------------------------
// JSON escrito a mano (modo avanzado)
// ---------------------------------------------------------------------------------------------

export type ParseRuleJsonResult = { ok: true; rule: Rule } | { ok: false; message: string };

class RuleJsonError extends Error {}

const show = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'una lista' : typeof v === 'string' ? `"${v}"` : String(v);

/**
 * Lee una regla escrita en JSON y explica en español dónde está el error. Acepta lo mismo que
 * `ruleSchema` y además reglas incompletas (grupos vacíos, comparaciones sin valor), que el
 * constructor muestra marcadas y `builderToRule` no deja guardar.
 */
export function parseRuleJson(text: string): ParseRuleJsonResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: `El JSON está mal formado: ${(err as Error).message}` };
  }
  try {
    return { ok: true, rule: readRule(data, '') };
  } catch (err) {
    if (err instanceof RuleJsonError) return { ok: false, message: err.message };
    if (err instanceof RangeError)
      return { ok: false, message: 'La regla tiene demasiados niveles de anidación.' };
    throw err;
  }
}

function fail(path: string, message: string): never {
  throw new RuleJsonError(`${path ? `En ${path}` : 'En la raíz'}: ${message}`);
}

function readRule(v: unknown, path: string): Rule {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    fail(path, `se esperaba un objeto y hay ${show(v)}.`);
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj);
  const at = (k: string) => (path ? `${path}.${k}` : k);

  for (const group of ['all', 'any'] as const) {
    if (!Object.hasOwn(obj, group)) continue;
    extraKeys(keys, [group], path);
    const list = obj[group];
    if (!Array.isArray(list)) fail(at(group), `se esperaba una lista de condiciones y hay ${show(list)}.`);
    const children = list.map((child, i) => readRule(child, `${at(group)}[${i}]`));
    return group === 'all' ? { all: children } : { any: children };
  }
  if (Object.hasOwn(obj, 'not')) {
    extraKeys(keys, ['not'], path);
    return { not: readRule(obj.not, at('not')) };
  }
  if (Object.hasOwn(obj, 'field') || Object.hasOwn(obj, 'op')) {
    extraKeys(keys, ['field', 'op', 'value'], path);
    const { field, op, value } = obj;
    if (!Object.hasOwn(obj, 'field')) fail(path, 'falta "field".');
    if (!Object.hasOwn(obj, 'op')) fail(path, 'falta "op".');
    if (!(PROFILE_FIELDS as readonly unknown[]).includes(field)) {
      fail(path, `${show(field)} no es un campo del perfil. Campos: ${PROFILE_FIELDS.join(', ')}.`);
    }
    if (!(OPERATORS as readonly unknown[]).includes(op)) {
      fail(path, `${show(op)} no es un operador. Operadores: ${OPERATORS.join(', ')}.`);
    }
    if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      fail(path, `"value" debe ser un número o null y hay ${show(value)}.`);
    }
    const cond: Condition = { field: field as ProfileField, op: op as Operator };
    if (Object.hasOwn(obj, 'value')) cond.value = value as number | null;
    return cond;
  }
  fail(
    path,
    'se esperaba una condición { "field", "op", "value" } o un grupo { "all" }, { "any" } o { "not" }.',
  );
}

function extraKeys(keys: string[], allowed: string[], path: string) {
  const extra = keys.filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    fail(
      path,
      `sobra ${extra.map((k) => `"${k}"`).join(', ')} (aquí solo va ${allowed.map((k) => `"${k}"`).join(', ')}).`,
    );
  }
}
