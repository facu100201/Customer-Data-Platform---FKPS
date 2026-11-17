import type { ProfileAggregates } from '@cdp/engine';
import { PROFILE_FIELDS } from '@cdp/shared';
import { api } from './api';
import type { SimCustomer } from './scenario';

/** Respuesta de GET /api/simulator/customers (backend/api/src/routes/simulator.ts). */
export type SimulatorPage = {
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  items: {
    id: string;
    updatedAt: string;
    tenureDays: number;
    aggregates: Partial<Record<keyof ProfileAggregates, number | null>>;
  }[];
};

export type FetchPage = (cursor: string | null) => Promise<SimulatorPage>;

export type Snapshot = {
  customers: Map<string, SimCustomer>;
  /** Posición del último perfil recibido; con ella se piden solo los nuevos o recalculados. */
  cursor: string | null;
  /** Perfiles visibles para el rol según la API en la última respuesta. */
  total: number;
};

const PAGE_SIZE = 5000;

export const fetchSimulatorPage: FetchPage = (cursor) =>
  api<SimulatorPage>(
    `/simulator/customers?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

const EMPTY_AGGREGATES = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, null])) as ProfileAggregates;

export const toSimCustomer = (item: SimulatorPage['items'][number]): SimCustomer => ({
  id: item.id,
  tenureDays: item.tenureDays,
  aggregates: { ...EMPTY_AGGREGATES, ...item.aggregates },
});

/** Pide páginas desde `start.cursor` hasta que no haya más y las mezcla por id sobre `start`. */
async function pull(fetchPage: FetchPage, start: Snapshot): Promise<Snapshot> {
  const customers = new Map(start.customers);
  let { cursor, total } = start;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.items) customers.set(item.id, toSimCustomer(item));
    cursor = page.nextCursor;
    total = page.total;
    if (!page.hasMore) return { customers, cursor, total };
  }
}

export const loadAll = (fetchPage: FetchPage = fetchSimulatorPage): Promise<Snapshot> =>
  pull(fetchPage, { customers: new Map(), cursor: null, total: 0 });

/**
 * Trae solo lo nuevo o recalculado desde el cursor. Si después de mezclar no coincide con el total
 * de la API (p. ej. un perfil se fusionó con otro y dejó de existir), recarga todo.
 */
export async function refresh(
  prev: Snapshot,
  fetchPage: FetchPage = fetchSimulatorPage,
): Promise<Snapshot & { fullReload: boolean }> {
  const next = await pull(fetchPage, prev);
  if (next.customers.size === next.total) return { ...next, fullReload: false };
  return { ...(await loadAll(fetchPage)), fullReload: true };
}
