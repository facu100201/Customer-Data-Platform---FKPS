import {
  appendChild,
  newCondition,
  newGroup,
  OPERATORS,
  operatorNeedsValue,
  PROFILE_FIELDS,
  removeNode,
  updateNode,
  type BuilderCondition,
  type BuilderGroup,
  type BuilderIssue,
  type BuilderNode,
  type Combinator,
  type Operator,
  type ProfileField,
} from '@cdp/shared';
import { COMBINATOR_LABELS, FIELD_LABELS, OPERATOR_LABELS } from '../services/segmentLabels';

/** Recibe una función que transforma el árbol; así el padre la aplica sobre su estado más reciente. */
type Edit = (fn: (tree: BuilderGroup) => BuilderGroup) => void;
type Issues = ReadonlyMap<string, BuilderIssue[]>;

/**
 * Constructor visual de reglas de segmento: grupos "todas / al menos una" anidables, con
 * condiciones campo · operador · valor. Cualquier nodo se puede negar.
 */
export function RuleBuilder({ tree, onEdit, issues }: { tree: BuilderGroup; onEdit: Edit; issues: Issues }) {
  return <GroupEditor group={tree} depth={0} onEdit={onEdit} issues={issues} />;
}

function GroupEditor({
  group,
  depth,
  onEdit,
  issues,
}: {
  group: BuilderGroup;
  depth: number;
  onEdit: Edit;
  issues: Issues;
}) {
  const isRoot = depth === 0;
  const set = (patch: Partial<BuilderGroup>) =>
    onEdit((t) => updateNode(t, group.id, (n) => ({ ...n, ...patch }) as BuilderNode));

  return (
    <div
      role="group"
      aria-label={isRoot ? 'Regla del segmento' : 'Grupo de condiciones'}
      className={isRoot ? 'space-y-2' : 'space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3'}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {isRoot && <span>Clientes que</span>}
        <select
          className="input w-auto max-w-full py-1"
          aria-label="Cumple o no cumple"
          value={group.negated ? 'no' : 'si'}
          onChange={(e) => set({ negated: e.target.value === 'no' })}
        >
          <option value="si">cumplen</option>
          <option value="no">no cumplen</option>
        </select>
        <select
          className="input w-auto max-w-full py-1"
          aria-label="Tipo de grupo"
          value={group.combinator}
          onChange={(e) => set({ combinator: e.target.value as Combinator })}
        >
          {(Object.keys(COMBINATOR_LABELS) as Combinator[]).map((c) => (
            <option key={c} value={c}>
              {COMBINATOR_LABELS[c]}
            </option>
          ))}
        </select>
        {!isRoot && (
          <button
            type="button"
            className="ml-auto text-xs text-slate-500 hover:text-red-600"
            onClick={() => onEdit((t) => removeNode(t, group.id))}
          >
            Quitar grupo
          </button>
        )}
      </div>
      <IssueList issues={issues.get(group.id)} />

      <ul className="space-y-2">
        {group.children.map((child) => (
          <li key={child.id}>
            {child.kind === 'group' ? (
              <GroupEditor group={child} depth={depth + 1} onEdit={onEdit} issues={issues} />
            ) : (
              <ConditionEditor condition={child} onEdit={onEdit} issues={issues} />
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost py-1 text-xs"
          onClick={() => onEdit((t) => appendChild(t, group.id, newCondition()))}
        >
          + Condición
        </button>
        <button
          type="button"
          className="btn-ghost py-1 text-xs"
          onClick={() => onEdit((t) => appendChild(t, group.id, newGroup('any')))}
        >
          + Grupo
        </button>
      </div>
    </div>
  );
}

function ConditionEditor({
  condition: c,
  onEdit,
  issues,
}: {
  condition: BuilderCondition;
  onEdit: Edit;
  issues: Issues;
}) {
  const set = (patch: Partial<BuilderCondition>) =>
    onEdit((t) => updateNode(t, c.id, (n) => ({ ...n, ...patch }) as BuilderNode));
  const own = issues.get(c.id);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-slate-600" title="Negar la condición">
        <input type="checkbox" checked={c.negated} onChange={(e) => set({ negated: e.target.checked })} />
        No
      </label>
      <select
        className="input w-auto max-w-full py-1"
        aria-label="Campo"
        value={c.field}
        onChange={(e) => set({ field: e.target.value as ProfileField })}
      >
        {PROFILE_FIELDS.map((f) => (
          <option key={f} value={f}>
            {FIELD_LABELS[f]}
          </option>
        ))}
      </select>
      <select
        className="input w-auto max-w-full py-1"
        aria-label="Operador"
        value={c.op}
        onChange={(e) => set({ op: e.target.value as Operator })}
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>
      {operatorNeedsValue(c.op) && (
        <input
          type="number"
          step="any"
          className={`input w-32 py-1 ${own ? 'border-red-400' : ''}`}
          aria-label="Valor"
          aria-invalid={own ? true : undefined}
          placeholder="Valor"
          value={c.value ?? ''}
          // vacío (o texto que el navegador no reconoce como número) queda como "sin valor"
          onChange={(e) => set({ value: e.target.value === '' ? null : Number(e.target.value) })}
        />
      )}
      <button
        type="button"
        className="text-slate-400 hover:text-red-600"
        aria-label="Quitar condición"
        title="Quitar condición"
        onClick={() => onEdit((t) => removeNode(t, c.id))}
      >
        ✕
      </button>
      <IssueList issues={own} />
    </div>
  );
}

function IssueList({ issues }: { issues: BuilderIssue[] | undefined }) {
  if (!issues?.length) return null;
  return (
    <p role="alert" className="w-full text-xs text-red-600">
      {issues.map((i) => i.message).join(' ')}
    </p>
  );
}
