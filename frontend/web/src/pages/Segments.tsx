import { builderToRule, type BuilderGroup, type BuilderIssue } from '@cdp/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { PageTitle } from '../components/Guard';
import { RuleBuilder } from '../components/RuleBuilder';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api, errorText } from '../services/api';
import {
  applyBuilderEdit,
  applyJsonEdit,
  deleteConfirmText,
  draftFromSegment,
  emptyDraft,
  formatJson,
  planPreview,
  planSave,
  previewText,
  revertJson,
  type ListedSegment,
  type SegmentDraft,
} from '../services/segmentForm';

type Segment = ListedSegment;

const NO_ISSUES: ReadonlyMap<string, BuilderIssue[]> = new Map();

/** Resultado de la vista previa junto con el árbol para el que se calculó. */
type Preview = { tree: BuilderGroup; matches: number; total: number };

export function Segments() {
  const { allowed } = useAuth();
  const { data, error, reload } = useApi<Segment[]>('/segments');
  const [draft, setDraft] = useState<SegmentDraft>(emptyDraft);
  // Los avisos por condición aparecen después del primer intento de guardar, no mientras se escribe
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const formRef = useRef<HTMLElement>(null);
  // Texto del JSON al enfocarlo: al salir solo se reformatea si la persona lo cambió
  const jsonAtFocus = useRef<string | null>(null);

  const original = draft.editingId ? (data?.find((s) => s.id === draft.editingId) ?? null) : null;
  const dirty =
    draft.editingId === null
      ? draft.ruleTouched ||
        draft.jsonError !== null ||
        draft.name.trim() !== '' ||
        draft.description.trim() !== ''
      : planSave(draft, original).kind !== 'unchanged';

  const issues = useMemo(() => {
    if (!showIssues) return NO_ISSUES;
    const result = builderToRule(draft.tree);
    if (result.ok) return NO_ISSUES;
    const byNode = new Map<string, BuilderIssue[]>();
    for (const i of result.issues) byNode.set(i.nodeId, [...(byNode.get(i.nodeId) ?? []), i]);
    return byNode;
  }, [showIssues, draft.tree]);

  // Cualquier edición borra el mensaje anterior ("revisa las condiciones", "creado con N…"): ya no
  // describe el formulario actual. Los avisos por condición siguen a la vista.
  const onEdit = useCallback((fn: (tree: BuilderGroup) => BuilderGroup) => {
    setDraft((d) => applyBuilderEdit(d, fn));
    setMsg(null);
  }, []);
  const onJsonChange = (text: string) => {
    setDraft((d) => applyJsonEdit(d, text));
    setMsg(null);
  };
  const onJsonBlur = () => {
    if (jsonAtFocus.current !== draft.jsonText) setDraft(formatJson);
    jsonAtFocus.current = null;
  };
  const toggleJson = () => {
    if (!jsonOpen) return setJsonOpen(true);
    // Cerrar con errores dejaría el constructor bloqueado sin ver por qué
    if (draft.jsonError) {
      if (!window.confirm('El JSON tiene errores. ¿Descartarlo y volver a la última regla válida?')) return;
      setDraft(revertJson);
    }
    setJsonOpen(false);
  };
  const setField = (patch: Partial<Pick<SegmentDraft, 'name' | 'description'>>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setMsg(null);
  };

  const discardOk = () => !dirty || window.confirm('Hay cambios sin guardar. ¿Descartarlos?');

  const reset = () => {
    setDraft(emptyDraft());
    setShowIssues(false);
    setPreview(null);
  };

  const startEdit = (s: Segment) => {
    if (!discardOk()) return;
    const opened = draftFromSegment(s);
    if (!opened.ok) {
      return setMsg('La regla guardada de este segmento no es válida; no se puede abrir en el constructor.');
    }
    setDraft(opened.draft);
    setShowIssues(false);
    setPreview(null);
    setMsg(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancel = () => {
    if (!discardOk()) return;
    reset();
    setMsg(null);
  };

  const save = async () => {
    setMsg(null);
    const plan = planSave(draft, original);
    if (plan.kind === 'invalid') {
      // Un nombre inválido no debe destapar avisos de una regla guardada que nadie tocó
      if (plan.issues.length > 0) setShowIssues(true);
      return setMsg(plan.message);
    }
    if (plan.kind === 'unchanged') return setMsg('No hay cambios que guardar.');

    setSaving(true);
    try {
      if (plan.kind === 'create') {
        const s = await api<Segment>('/segments', { method: 'POST', json: plan.body });
        setMsg(`Segmento creado con ${s.size} perfiles.`);
      } else {
        const s = await api<Segment>(`/segments/${plan.id}`, { method: 'PATCH', json: plan.body });
        setMsg(
          plan.body.definition
            ? `Segmento actualizado y recalculado: ${s.size} perfiles.`
            : 'Segmento actualizado.',
        );
      }
      reset();
      reload();
    } catch (err) {
      setMsg(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  /** Cuenta cuántos perfiles cumplirían la regla actual. No guarda nada. */
  const runPreview = async () => {
    setMsg(null);
    const tree = draft.tree;
    const plan = planPreview(draft);
    if (plan.kind === 'invalid') {
      if (plan.issues.length > 0) setShowIssues(true);
      return setMsg(plan.message);
    }
    setPreviewing(true);
    try {
      const r = await api<{ matches: number; total: number }>('/segments/preview', {
        method: 'POST',
        json: plan.body,
      });
      // Se guarda con el árbol que se mandó: si la regla cambió mientras tanto, ya no se muestra
      setPreview({ tree, ...r });
    } catch (err) {
      setMsg(errorText(err));
    } finally {
      setPreviewing(false);
    }
  };

  const remove = async (s: Segment) => {
    if (!window.confirm(deleteConfirmText(s))) return;
    setMsg(null);
    setDeletingId(s.id);
    try {
      await api(`/segments/${s.id}`, { method: 'DELETE' });
      if (draft.editingId === s.id) reset();
      setMsg(`Segmento "${s.name}" eliminado.`);
    } catch (err) {
      setMsg(errorText(err));
    } finally {
      setDeletingId(null);
      reload();
    }
  };

  const refresh = async (id: string) => {
    await api(`/segments/${id}/refresh`, { method: 'POST' }).catch((e: unknown) => setMsg(errorText(e)));
    reload();
  };

  const editing = draft.editingId !== null;
  const previewCurrent = preview !== null && preview.tree === draft.tree && !draft.jsonError;
  const jsonInvalid = draft.jsonError !== null;

  return (
    <>
      <PageTitle title="Segmentos" />
      {error && <p className="card text-red-600">{error}</p>}
      <div className="space-y-4">
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Perfiles</th>
                <th>Actualizado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id} className={s.id === draft.editingId ? 'bg-brand-50' : undefined}>
                  <td>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.description}</p>
                  </td>
                  <td className="tabular-nums">{s.size}</td>
                  <td className="text-xs">
                    {s.refreshedAt ? new Date(s.refreshedAt).toLocaleString('es-MX') : 'nunca'}
                  </td>
                  <td>
                    {allowed('segments:write') && (
                      <div className="flex justify-end gap-2">
                        <button className="btn-ghost" onClick={() => startEdit(s)}>
                          Editar
                        </button>
                        <button className="btn-ghost" onClick={() => void refresh(s.id)}>
                          Recalcular
                        </button>
                        <button
                          className="btn-ghost text-red-700 hover:bg-red-50"
                          disabled={deletingId === s.id}
                          onClick={() => void remove(s)}
                        >
                          {deletingId === s.id ? 'Eliminando…' : 'Eliminar'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {allowed('segments:write') && (
          <section ref={formRef} className="card space-y-3" aria-labelledby="segment-form-title">
            <h2 id="segment-form-title" className="text-sm font-medium">
              {editing ? `Editar segmento: ${original?.name ?? ''}` : 'Nuevo segmento'}
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              <input
                className="input"
                placeholder="Nombre"
                aria-label="Nombre"
                value={draft.name}
                onChange={(e) => setField({ name: e.target.value })}
              />
              <input
                className="input"
                placeholder="Descripción (opcional)"
                aria-label="Descripción"
                value={draft.description}
                onChange={(e) => setField({ description: e.target.value })}
              />
            </div>

            {/* Con el JSON inválido el constructor se bloquea: editarlo borraría lo que se escribió */}
            <fieldset disabled={jsonInvalid} className="min-w-0 disabled:opacity-50">
              <RuleBuilder tree={draft.tree} onEdit={onEdit} issues={issues} />
            </fieldset>
            {jsonInvalid && (
              <p className="text-xs text-slate-500">
                El constructor muestra la última regla válida y queda bloqueado hasta corregir el JSON.
              </p>
            )}

            <div>
              <button
                type="button"
                className="text-xs text-brand-700 hover:underline"
                aria-expanded={jsonOpen}
                aria-controls="segment-json"
                onClick={toggleJson}
              >
                {jsonOpen ? 'Ocultar JSON' : 'Modo avanzado: ver y editar la regla en JSON'}
              </button>
              {jsonOpen && (
                <div id="segment-json" className="mt-2 space-y-2">
                  <textarea
                    className={`input h-64 font-mono text-xs ${jsonInvalid ? 'border-red-400' : ''}`}
                    aria-label="Regla en JSON"
                    aria-invalid={jsonInvalid || undefined}
                    aria-describedby={jsonInvalid ? 'segment-json-error' : undefined}
                    spellCheck={false}
                    value={draft.jsonText}
                    onChange={(e) => onJsonChange(e.target.value)}
                    onFocus={() => (jsonAtFocus.current = draft.jsonText)}
                    onBlur={onJsonBlur}
                  />
                  {jsonInvalid ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p id="segment-json-error" role="alert" className="text-xs text-red-600">
                        {draft.jsonError}
                      </p>
                      <button
                        type="button"
                        className="btn-ghost py-1 text-xs"
                        onClick={() => setDraft(revertJson)}
                      >
                        Volver a la última regla válida
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Los cambios válidos se ven al instante en el constructor. Campos, operadores y grupos
                      (all, any, not) son los mismos que en el constructor.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <button
                className="btn-ghost py-1"
                disabled={previewing || jsonInvalid}
                onClick={() => void runPreview()}
              >
                {previewing ? 'Calculando…' : 'Vista previa'}
              </button>
              <p aria-live="polite" className={previewCurrent ? '' : 'text-slate-500'}>
                {previewCurrent
                  ? previewText(preview.matches, preview.total)
                  : preview
                    ? 'La regla cambió; vuelve a calcular la vista previa.'
                    : 'Cuenta cuántos perfiles cumplen la regla, sin guardar nada.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <button
                className="btn-primary"
                disabled={saving || jsonInvalid || draft.name.trim().length < 3}
                onClick={() => void save()}
              >
                {editing ? 'Guardar cambios' : 'Crear y calcular'}
              </button>
              {(editing || dirty) && (
                <button className="btn-ghost" disabled={saving} onClick={cancel}>
                  {editing ? 'Cancelar edición' : 'Limpiar'}
                </button>
              )}
              {msg && (
                <p className="text-sm" role="status">
                  {msg}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
