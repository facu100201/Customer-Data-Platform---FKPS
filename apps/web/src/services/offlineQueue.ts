import type { CdpEventInput } from '@cdp/shared';
import Dexie, { type EntityTable } from 'dexie';
import { api, ApiError } from './api';

type QueuedEvent = { id?: number; event: CdpEventInput; queuedAt: number };
type SavedScenario = { id?: number; name: string; createdAt: number; params: Record<string, unknown> };

/**
 * IndexedDB local de la terminal. Solo guarda lo que aún no llega al servidor (cola offline) y los
 * escenarios del simulador; el perfil del cliente siempre vive en el servidor.
 */
export const db = new Dexie('cdp-terminal') as Dexie & {
  queue: EntityTable<QueuedEvent, 'id'>;
  scenarios: EntityTable<SavedScenario, 'id'>;
};
db.version(1).stores({ queue: '++id, queuedAt', scenarios: '++id, name, createdAt' });

export async function sendOrQueue(event: CdpEventInput): Promise<'sent' | 'queued'> {
  try {
    await api('/events', { method: 'POST', json: event });
    return 'sent';
  } catch (err) {
    // un 4xx no se arregla reintentando (evento inválido o sin permiso): se reporta, no se encola
    if (err instanceof ApiError && err.status < 500) throw err;
    await db.queue.add({ event, queuedAt: Date.now() });
    return 'queued';
  }
}

/** Reenvía la cola en lotes de 100. Se llama al recuperar conexión y cada 30 s. */
export async function flushQueue(): Promise<number> {
  let sent = 0;
  for (;;) {
    const batch = await db.queue.orderBy('queuedAt').limit(100).toArray();
    if (batch.length === 0) return sent;
    await api('/events', { method: 'POST', json: { events: batch.map((b) => b.event) } });
    await db.queue.bulkDelete(batch.map((b) => b.id!));
    sent += batch.length;
  }
}

export const pendingCount = () => db.queue.count();
