import { useCallback, useEffect, useState } from 'react';
import type { ScenarioParams } from '../services/scenario';
import { deleteScenario, listScenarios, saveScenario, type StoredScenario } from '../services/scenarioStore';

export const STORAGE_ERROR = 'No se pudo usar el almacenamiento local de este navegador (IndexedDB).';

type State = { items: StoredScenario[]; invalid: number; loadError: string | null };

/**
 * Escenarios guardados del usuario (IndexedDB). Lo comparten el panel de guardado y la comparación.
 * `save` y `remove` lanzan el error de IndexedDB para que quien los llame lo muestre.
 */
export function useSavedScenarios(ownerId: string | undefined) {
  const [state, setState] = useState<State>({ items: [], invalid: 0, loadError: null });

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    listScenarios(ownerId)
      .then((r) => {
        if (!cancelled) setState({ ...r, loadError: null });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loadError: STORAGE_ERROR }));
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  const reload = useCallback(async () => {
    if (!ownerId) return;
    setState({ ...(await listScenarios(ownerId)), loadError: null });
  }, [ownerId]);

  const save = useCallback(
    async (name: string, params: ScenarioParams, replaceId?: number) => {
      if (!ownerId) throw new Error('Sin sesión');
      const id = await saveScenario(ownerId, name, params, replaceId);
      await reload();
      return id;
    },
    [ownerId, reload],
  );

  const remove = useCallback(
    async (id: number) => {
      if (!ownerId) return;
      await deleteScenario(ownerId, id);
      await reload();
    },
    [ownerId, reload],
  );

  return { ...state, save, remove };
}
