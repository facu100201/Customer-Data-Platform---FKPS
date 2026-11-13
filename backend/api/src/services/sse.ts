import type { ServerResponse } from 'node:http';
import type { Permission, Role } from '@cdp/shared';
import { can } from '@cdp/shared';

export type StreamMessage =
  | { type: 'event'; data: { customerId: string; name: string; terminalId?: string; at: string } }
  | { type: 'terminal'; data: { id: string; at: string } }
  | { type: 'alert'; data: { id: string; severity: string; summary: string } }
  | { type: 'merge'; data: { winnerId: string; loserId: string; status: string } };

const REQUIRED: Record<StreamMessage['type'], Permission> = {
  event: 'dashboard:read',
  terminal: 'terminals:read',
  alert: 'security:read',
  merge: 'customers:read',
};

type Client = { res: ServerResponse; role: Role };

/** Difunde mensajes en vivo al dashboard. Cada cliente solo recibe lo que su rol puede ver. */
export class SseHub {
  private clients = new Set<Client>();

  add(res: ServerResponse, role: Role): () => void {
    const client = { res, role };
    this.clients.add(client);
    return () => this.clients.delete(client);
  }

  publish(msg: StreamMessage): void {
    const frame = `event: ${msg.type}\ndata: ${JSON.stringify(msg.data)}\n\n`;
    for (const c of this.clients) {
      if (can(c.role, REQUIRED[msg.type])) c.res.write(frame);
    }
  }

  get size(): number {
    return this.clients.size;
  }
}
