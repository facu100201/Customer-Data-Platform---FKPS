import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorText } from '../services/api';
import type { SimCustomer } from '../services/scenario';
import { loadAll, refresh, type Snapshot } from '../services/simulatorData';

type State = {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  loadedAt: Date | null;
  /** La última actualización tuvo que recargar todo porque el total no cuadraba. */
  fullReload: boolean;
};

/**
 * Perfiles para el simulador. Al abrir la página se cargan completos; "Actualizar" pide solo los nuevos
 * o recalculados desde el último cursor. Viven en memoria: no se guardan en el dispositivo.
 */
export function useSimulatorData() {
  const [state, setState] = useState<State>({
    snapshot: null,
    loading: true,
    error: null,
    loadedAt: null,
    fullReload: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadAll()
      .then((snapshot) => {
        if (!cancelled)
          setState({ snapshot, loading: false, error: null, loadedAt: new Date(), fullReload: false });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: errorText(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { snapshot } = state;
  const update = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const next = snapshot ? await refresh(snapshot) : { ...(await loadAll()), fullReload: true };
      const { fullReload, ...rest } = next;
      setState({ snapshot: rest, loading: false, error: null, loadedAt: new Date(), fullReload });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorText(e) }));
    }
  }, [snapshot]);

  const customers = useMemo<SimCustomer[]>(
    () => (snapshot ? [...snapshot.customers.values()] : []),
    [snapshot],
  );

  return { ...state, customers, update };
}
