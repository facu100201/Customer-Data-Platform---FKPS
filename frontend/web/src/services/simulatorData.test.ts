import { describe, expect, it } from 'vitest';
import { loadAll, refresh, toSimCustomer, type FetchPage, type SimulatorPage } from './simulatorData';

type Item = SimulatorPage['items'][number];
const item = (id: string, orders = 1): Item => ({
  id,
  updatedAt: '2026-11-01T00:00:00.000Z',
  tenureDays: 30,
  aggregates: { orders_30d: orders, avg_order_value: 100 },
});

/** API falsa: un "servidor" con páginas por cursor y un total, que registra los cursores pedidos. */
function fakeApi(pages: Record<string, SimulatorPage>) {
  const asked: (string | null)[] = [];
  const fetchPage: FetchPage = async (cursor) => {
    asked.push(cursor);
    const page = pages[cursor ?? 'inicio'];
    if (!page) throw new Error(`cursor inesperado ${cursor}`);
    return page;
  };
  return { fetchPage, asked };
}

describe('datos del simulador', () => {
  it('completa los campos de agregados que la API no manda', () => {
    const c = toSimCustomer(item('a'));
    expect(c.aggregates.orders_30d).toBe(1);
    expect(c.aggregates.spend_total).toBeNull();
    expect(Object.keys(c.aggregates).length).toBeGreaterThan(7);
  });

  it('la carga completa recorre todas las páginas', async () => {
    const { fetchPage, asked } = fakeApi({
      inicio: { total: 3, hasMore: true, nextCursor: 'c2', items: [item('a'), item('b')] },
      c2: { total: 3, hasMore: false, nextCursor: 'c3', items: [item('c')] },
    });
    const s = await loadAll(fetchPage);
    expect(asked).toEqual([null, 'c2']);
    expect([...s.customers.keys()]).toEqual(['a', 'b', 'c']);
    expect(s).toMatchObject({ cursor: 'c3', total: 3 });
  });

  it('actualizar pide solo desde el cursor y mezcla por id', async () => {
    const { fetchPage, asked } = fakeApi({
      inicio: { total: 2, hasMore: false, nextCursor: 'c1', items: [item('a'), item('b')] },
      c1: { total: 3, hasMore: false, nextCursor: 'c2', items: [item('b', 5), item('c')] },
    });
    const first = await loadAll(fetchPage);
    const next = await refresh(first, fetchPage);
    expect(asked).toEqual([null, 'c1']);
    expect(next.fullReload).toBe(false);
    expect(next.customers.size).toBe(3);
    expect(next.customers.get('b')?.aggregates.orders_30d).toBe(5);
    expect(next.cursor).toBe('c2');
    // no muta la instantánea anterior (React la compara por referencia)
    expect(first.customers.size).toBe(2);
  });

  it('si el total no coincide (un perfil se fusionó y desapareció) recarga todo', async () => {
    const pages: Record<string, SimulatorPage> = {
      inicio: { total: 3, hasMore: false, nextCursor: 'c1', items: [item('a'), item('b'), item('c')] },
      c1: { total: 2, hasMore: false, nextCursor: 'c2', items: [item('a', 9)] },
    };
    const { fetchPage, asked } = fakeApi(pages);
    const first = await loadAll(fetchPage);
    // a partir de aquí el servidor ya no tiene a "c"
    pages.inicio = { total: 2, hasMore: false, nextCursor: 'c2', items: [item('a', 9), item('b')] };
    const next = await refresh(first, fetchPage);
    expect(asked).toEqual([null, 'c1', null]);
    expect(next.fullReload).toBe(true);
    expect([...next.customers.keys()]).toEqual(['a', 'b']);
    expect(next.customers.get('a')?.aggregates.orders_30d).toBe(9);
  });

  it('sin cambios no recarga', async () => {
    const { fetchPage, asked } = fakeApi({
      inicio: { total: 1, hasMore: false, nextCursor: 'c1', items: [item('a')] },
      c1: { total: 1, hasMore: false, nextCursor: 'c1', items: [] },
    });
    const next = await refresh(await loadAll(fetchPage), fetchPage);
    expect(asked).toEqual([null, 'c1']);
    expect(next).toMatchObject({ fullReload: false, cursor: 'c1', total: 1 });
  });
});
