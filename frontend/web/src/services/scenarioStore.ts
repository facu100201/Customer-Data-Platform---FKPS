import { db, type SavedScenario } from './offlineQueue';
import { parseParams, type ScenarioParams } from './scenario';

/**
 * Escenarios del simulador guardados en IndexedDB (tabla `scenarios` de la base local de la terminal).
 * Solo se guardan los valores de los controles, nunca datos de clientes. Cada escenario queda a nombre
 * del usuario que lo guardó: en una terminal compartida cada quien ve solo los suyos.
 */

export type StoredScenario = { id: number; name: string; createdAt: number; params: ScenarioParams };

export const NAME_MAX = 60;

/** Quita espacios sobrantes; el resultado es lo que se guarda y lo que se compara. */
export const normalizeName = (raw: string) => raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);

/** Nombres iguales sin importar mayúsculas ni espacios extra. */
export const sameName = (a: string, b: string) =>
  normalizeName(a).toLocaleLowerCase('es') === normalizeName(b).toLocaleLowerCase('es');

export const findByName = (items: readonly StoredScenario[], name: string) =>
  items.find((s) => sameName(s.name, name));

/**
 * Escenarios del usuario, del más reciente al más antiguo. Los registros que no pasan la validación
 * no se muestran y se cuentan en `invalid`.
 */
export async function listScenarios(ownerId: string): Promise<{ items: StoredScenario[]; invalid: number }> {
  const rows = await db.scenarios.orderBy('createdAt').reverse().toArray();
  const items: StoredScenario[] = [];
  let invalid = 0;
  for (const row of rows) {
    if (row.ownerId !== ownerId) continue;
    const params = parseParams(row.params);
    if (row.id === undefined || !params || typeof row.name !== 'string') invalid += 1;
    else items.push({ id: row.id, name: row.name, createdAt: row.createdAt, params });
  }
  return { items, invalid };
}

/** Guarda un escenario nuevo o, con `replaceId`, reemplaza uno existente del mismo usuario. */
export async function saveScenario(
  ownerId: string,
  name: string,
  params: ScenarioParams,
  replaceId?: number,
): Promise<number> {
  const clean = normalizeName(name);
  if (!clean) throw new Error('El escenario necesita un nombre');
  const record: SavedScenario = { name: clean, createdAt: Date.now(), params, ownerId };
  if (replaceId === undefined) return (await db.scenarios.add(record)) as number;
  const current = await db.scenarios.get(replaceId);
  if (!current || current.ownerId !== ownerId) throw new Error('El escenario ya no existe');
  await db.scenarios.put({ ...record, id: replaceId });
  return replaceId;
}

export async function deleteScenario(ownerId: string, id: number): Promise<void> {
  const current = await db.scenarios.get(id);
  if (current && current.ownerId === ownerId) await db.scenarios.delete(id);
}
