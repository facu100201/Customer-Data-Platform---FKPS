import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../services/api';

type Result<T> = { key: string; data: T | null; error: string | null };

/** GET con estado de carga y error; `reload` vuelve a pedir los datos. */
export function useApi<T>(path: string | null) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  // Cada petición tiene una llave; "cargando" = la última respuesta no es de la petición actual.
  // Así no hace falta un setState síncrono dentro del efecto.
  const key = path === null ? null : `${version}:${path}`;

  useEffect(() => {
    if (path === null || key === null) return;
    let cancelled = false;
    api<T>(path)
      .then((data) => {
        if (!cancelled) setResult({ key, data, error: null });
      })
      .catch((e: unknown) => {
        // Si falla se conservan los datos anteriores y solo se muestra el error
        if (!cancelled) setResult((prev) => ({ key, data: prev?.data ?? null, error: errorText(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return {
    data: result?.data ?? null,
    error: result?.error ?? null,
    loading: key !== null && result?.key !== key,
    reload,
  };
}
