import { useEffect, useRef } from 'react';

type Handlers = Partial<Record<'event' | 'terminal' | 'alert' | 'merge', (data: unknown) => void>>;

/** Se suscribe al canal SSE /api/stream. EventSource reconecta solo si se cae la red. */
export function useStream(handlers: Handlers) {
  const ref = useRef(handlers);
  // Se actualiza después de cada render (no durante): los mensajes SSE siempre llegan después
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const source = new EventSource('/api/stream', { withCredentials: true });
    const types = ['event', 'terminal', 'alert', 'merge'] as const;
    const listeners = types.map((type) => {
      const fn = (e: MessageEvent<string>) => ref.current[type]?.(JSON.parse(e.data));
      source.addEventListener(type, fn);
      return [type, fn] as const;
    });
    return () => {
      for (const [type, fn] of listeners) source.removeEventListener(type, fn);
      source.close();
    };
  }, []);
}
