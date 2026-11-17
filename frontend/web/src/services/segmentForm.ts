import {
  builderToDraftRule,
  builderToRule,
  newGroup,
  parseRuleJson,
  ruleSchema,
  ruleToBuilder,
  type BuilderGroup,
  type BuilderIssue,
  type Rule,
} from '@cdp/shared';

export type SavedSegment = { id: string; name: string; description: string | null; definition: Rule };

/** Lo que muestra la lista; los conteos sirven para avisar qué se pierde al borrar. */
export type ListedSegment = SavedSegment & {
  size: number;
  activationCount: number;
  refreshedAt: string | null;
};

export type SegmentDraft = {
  /** null = segmento nuevo */
  editingId: string | null;
  name: string;
  description: string;
  tree: BuilderGroup;
  /**
   * Si la persona tocó la regla. Mientras sea false, al editar no se manda `definition` y la regla
   * guardada se queda exactamente como está (aunque no esté en forma canónica).
   */
  ruleTouched: boolean;
  /** Texto del modo JSON. Siempre sincronizado con `tree`, salvo mientras tenga errores. */
  jsonText: string;
  /** Error del JSON escrito a mano. Mientras exista, no se guarda ni se previsualiza. */
  jsonError: string | null;
  /** Último texto JSON válido, para "volver a la última regla válida" sin reformatear nada. */
  jsonLastValid: string;
};

export type CreateBody = { name: string; description?: string; definition: Rule };
export type UpdateBody = { name?: string; description?: string | null; definition?: Rule };

export type SavePlan =
  | { kind: 'create'; body: CreateBody }
  | { kind: 'update'; id: string; body: UpdateBody }
  | { kind: 'unchanged' }
  | { kind: 'invalid'; message: string; issues: BuilderIssue[] };

const toJsonText = (rule: Rule) => JSON.stringify(rule, null, 2);
const treeJson = (tree: BuilderGroup) => toJsonText(builderToDraftRule(tree));

export const emptyDraft = (): SegmentDraft => {
  const tree = newGroup('all');
  const jsonText = treeJson(tree);
  return {
    editingId: null,
    name: '',
    description: '',
    tree,
    ruleTouched: false,
    jsonText,
    jsonError: null,
    jsonLastValid: jsonText,
  };
};

/** Abre un segmento guardado en el constructor. Falla solo si la regla guardada no es válida. */
export function draftFromSegment(s: SavedSegment): { ok: true; draft: SegmentDraft } | { ok: false } {
  const parsed = ruleSchema.safeParse(s.definition);
  if (!parsed.success) return { ok: false };
  const jsonText = toJsonText(s.definition);
  return {
    ok: true,
    draft: {
      editingId: s.id,
      name: s.name,
      description: s.description ?? '',
      tree: ruleToBuilder(parsed.data),
      ruleTouched: false,
      // el JSON guardado tal cual, no la forma canónica: "ver la regla" muestra lo que hay en la base
      jsonText,
      jsonError: null,
      jsonLastValid: jsonText,
    },
  };
}

/**
 * Decide qué mandar a la API. Al editar solo se mandan los campos que cambiaron; la regla solo si
 * se tocó en el constructor.
 */
const JSON_INVALID =
  'El JSON de la regla tiene errores: corrígelo o vuelve a la última regla válida antes de guardar.';

export function planSave(draft: SegmentDraft, original: SavedSegment | null): SavePlan {
  if (draft.jsonError) return { kind: 'invalid', message: JSON_INVALID, issues: [] };
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (name.length < 3 || name.length > 80) {
    return { kind: 'invalid', message: 'El nombre debe tener entre 3 y 80 caracteres.', issues: [] };
  }
  if (description.length > 500) {
    return { kind: 'invalid', message: 'La descripción admite hasta 500 caracteres.', issues: [] };
  }

  const needsRule = draft.editingId === null || draft.ruleTouched;
  const converted = needsRule ? builderToRule(draft.tree) : null;
  if (converted && !converted.ok) {
    return {
      kind: 'invalid',
      message: 'Revisa las condiciones marcadas en la regla.',
      issues: converted.issues,
    };
  }
  const definition = converted?.ok ? converted.rule : undefined;

  if (draft.editingId === null) {
    return {
      kind: 'create',
      body: { name, ...(description && { description }), definition: definition as Rule },
    };
  }

  const body: UpdateBody = {};
  if (name !== original?.name) body.name = name;
  if ((description || null) !== (original?.description ?? null)) body.description = description || null;
  if (definition !== undefined) body.definition = definition;
  if (Object.keys(body).length === 0) return { kind: 'unchanged' };
  return { kind: 'update', id: draft.editingId, body };
}

export type PreviewPlan =
  | { kind: 'preview'; body: { definition: Rule } }
  | { kind: 'invalid'; message: string; issues: BuilderIssue[] };

/**
 * Vista previa de la regla tal como está en el constructor (tocada o no). Usa la misma conversión
 * que al guardar, así el conteo corresponde a lo que se guardaría.
 */
export function planPreview(draft: SegmentDraft): PreviewPlan {
  if (draft.jsonError) return { kind: 'invalid', message: JSON_INVALID, issues: [] };
  const converted = builderToRule(draft.tree);
  if (!converted.ok) {
    return {
      kind: 'invalid',
      message: 'Revisa las condiciones marcadas en la regla.',
      issues: converted.issues,
    };
  }
  return { kind: 'preview', body: { definition: converted.rule } };
}

/** "12 de 340 perfiles (3.5 %)" */
export function previewText(matches: number, total: number): string {
  const n = (v: number) => v.toLocaleString('es-MX');
  if (total === 0) return 'Todavía no hay perfiles para evaluar.';
  const pct = (matches / total) * 100;
  const pctText = pct > 0 && pct < 0.1 ? '< 0.1' : pct.toLocaleString('es-MX', { maximumFractionDigits: 1 });
  return `Coinciden ${n(matches)} de ${n(total)} perfiles (${pctText} %).`;
}

// ---------------------------------------------------------------------------------------------
// Sincronía constructor ⇄ JSON
// ---------------------------------------------------------------------------------------------

/** Edición en el constructor: el JSON se regenera a partir del árbol. */
export function applyBuilderEdit(d: SegmentDraft, fn: (tree: BuilderGroup) => BuilderGroup): SegmentDraft {
  const tree = fn(d.tree);
  const jsonText = treeJson(tree);
  return { ...d, tree, ruleTouched: true, jsonText, jsonError: null, jsonLastValid: jsonText };
}

/**
 * Edición en el JSON: si se lee bien, el constructor pasa a mostrarlo; si no, el constructor se
 * queda con la última regla válida y el error bloquea guardar y previsualizar.
 *
 * Solo cuenta como "regla tocada" si la regla cambió. Un JSON inválido no la cambia, y tampoco
 * espacios, orden de llaves u otras formas de escribir la misma regla: así, abrir un segmento,
 * teclear en el JSON y dejarlo como estaba no reescribe la regla guardada.
 */
export function applyJsonEdit(d: SegmentDraft, text: string): SegmentDraft {
  const parsed = parseRuleJson(text);
  if (!parsed.ok) return { ...d, jsonText: text, jsonError: parsed.message };
  const tree = ruleToBuilder(parsed.rule);
  const same = treeJson(tree) === treeJson(d.tree);
  return {
    ...d,
    // misma regla: se conserva el árbol (y con él la vista previa ya calculada)
    tree: same ? d.tree : tree,
    ruleTouched: d.ruleTouched || !same,
    jsonText: text,
    jsonError: null,
    jsonLastValid: text,
  };
}

/** Al salir del JSON editado: se reescribe en la forma en que se guardará (solo si es válido). */
export function formatJson(d: SegmentDraft): SegmentDraft {
  if (d.jsonError) return d;
  const text = treeJson(d.tree);
  return text === d.jsonText ? d : { ...d, jsonText: text, jsonLastValid: text };
}

/** Descarta el JSON con errores y vuelve al último texto válido (que es el que muestra el constructor). */
export function revertJson(d: SegmentDraft): SegmentDraft {
  return { ...d, jsonText: d.jsonLastValid, jsonError: null };
}

// ---------------------------------------------------------------------------------------------
// Borrado
// ---------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('es-MX')} ${n === 1 ? one : many}`;

/** Texto de la confirmación: dice qué más se borra (las activaciones se van en cascada). */
export function deleteConfirmText(s: ListedSegment): string {
  const lost = [`su membresía (${plural(s.size, 'perfil', 'perfiles')})`];
  if (s.activationCount > 0) {
    lost.push(plural(s.activationCount, 'activación', 'activaciones'));
  }
  return `¿Eliminar el segmento "${s.name}"?\n\nTambién se borran ${lost.join(' y ')}. No se puede deshacer.`;
}
