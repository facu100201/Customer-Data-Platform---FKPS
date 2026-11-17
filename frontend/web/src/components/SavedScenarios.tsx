import { useId, useState, type FormEvent } from 'react';
import { STORAGE_ERROR } from '../hooks/useSavedScenarios';
import { describeChanges, sameParams, type ScenarioParams } from '../services/scenario';
import { NAME_MAX, findByName, normalizeName, type StoredScenario } from '../services/scenarioStore';

const when = (ms: number) => new Date(ms).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

function summary(params: ScenarioParams) {
  const changes = describeChanges(params);
  if (changes.length === 0) return 'Valores por defecto';
  const shown = changes.slice(0, 3).map((c) => `${c.label}: ${c.value}`);
  return changes.length > 3 ? `${shown.join(' · ')} · y ${changes.length - 3} más` : shown.join(' · ');
}

/** Guardar, cargar y borrar escenarios en IndexedDB (solo los del usuario con sesión). */
export function SavedScenarios({
  items,
  invalid,
  loadError,
  params,
  activeId,
  onActiveChange,
  onLoad,
  onSave,
  onDelete,
}: {
  items: StoredScenario[];
  invalid: number;
  loadError: string | null;
  params: ScenarioParams;
  /** Escenario cargado en los controles (null si no hay o si se restablecieron los valores). */
  activeId: number | null;
  onActiveChange: (id: number | null) => void;
  onLoad: (params: ScenarioParams) => void;
  onSave: (name: string, params: ScenarioParams, replaceId?: number) => Promise<number>;
  onDelete: (id: number) => Promise<void>;
}) {
  const inputId = useId();
  const [name, setName] = useState('');
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const clean = normalizeName(name);
  const existing = clean ? findByName(items, clean) : undefined;
  const active = items.find((s) => s.id === activeId);
  const shownStatus = status ?? (loadError ? { text: loadError, error: true } : null);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      setStatus({ text: await action(), error: false });
    } catch {
      setStatus({ text: STORAGE_ERROR, error: true });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!clean) return;
    void run(async () => {
      const id = await onSave(clean, params, existing?.id);
      onActiveChange(id);
      setName('');
      return existing ? `Se reemplazó «${clean}».` : `Se guardó «${clean}».`;
    });
  }

  function onLoadClick(s: StoredScenario) {
    onLoad(s.params);
    onActiveChange(s.id);
    setConfirmId(null);
    setStatus({ text: `Se cargó «${s.name}».`, error: false });
  }

  function onDeleteClick(s: StoredScenario) {
    setConfirmId(null);
    void run(async () => {
      await onDelete(s.id);
      if (activeId === s.id) onActiveChange(null);
      return `Se eliminó «${s.name}».`;
    });
  }

  return (
    <section className="card min-w-0 space-y-3" aria-label="Escenarios guardados">
      <div>
        <h2 className="text-sm font-medium">Escenarios guardados</h2>
        <p className="text-xs text-slate-400">
          Solo en este navegador y solo para tu usuario. Se guardan los valores de los controles, no datos de
          clientes.
        </p>
      </div>

      <form className="space-y-1" onSubmit={onSubmit}>
        <label htmlFor={inputId} className="text-sm">
          Nombre del escenario
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            className="input"
            value={name}
            maxLength={NAME_MAX}
            placeholder="p. ej. Retención agresiva"
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn-primary shrink-0" type="submit" disabled={!clean || busy}>
            {existing ? 'Reemplazar' : 'Guardar'}
          </button>
        </div>
        {existing && (
          <p className="text-xs text-amber-700">
            Ya tienes un escenario llamado «{existing.name}»: se reemplazará con los valores actuales.
          </p>
        )}
      </form>

      {shownStatus && (
        <p role="status" className={`text-xs ${shownStatus.error ? 'text-red-600' : 'text-slate-500'}`}>
          {shownStatus.text}
        </p>
      )}
      {invalid > 0 && (
        <p className="text-xs text-amber-700">
          {invalid} escenario(s) guardado(s) con un formato que ya no es válido no se muestran.
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-xs text-slate-400">Aún no has guardado escenarios.</p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="Lista de escenarios">
          {items.map((s) => {
            const isActive = s.id === activeId;
            const modified = isActive && active !== undefined && !sameParams(params, active.params);
            return (
              <li key={s.id} className="py-2" data-testid="saved-scenario">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={s.name}>
                      {s.name}
                    </p>
                    {isActive && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs whitespace-nowrap text-brand-900">
                        {modified ? 'activo · modificado' : 'activo'}
                      </span>
                    )}
                    <p className="text-xs text-slate-400">{when(s.createdAt)}</p>
                    <p className="text-xs text-slate-500">{summary(s.params)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {confirmId === s.id ? (
                      <>
                        <button
                          className="btn-ghost px-2 py-1 text-red-600"
                          onClick={() => onDeleteClick(s)}
                          disabled={busy}
                          aria-label={`Confirmar eliminar ${s.name}`}
                        >
                          Sí, eliminar
                        </button>
                        <button className="btn-ghost px-2 py-1" onClick={() => setConfirmId(null)}>
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn-ghost px-2 py-1"
                          onClick={() => onLoadClick(s)}
                          aria-label={`Cargar ${s.name}`}
                        >
                          Cargar
                        </button>
                        <button
                          className="btn-ghost px-2 py-1"
                          onClick={() => setConfirmId(s.id)}
                          aria-label={`Eliminar ${s.name}`}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
