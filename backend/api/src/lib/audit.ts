import type { Prisma, PrismaClient } from '@prisma/client';

export type AuditEntry = {
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  ip?: string;
  meta?: Prisma.InputJsonValue;
};

/** La auditoría nunca debe tumbar la petición: si falla se registra en el log y sigue. */
export function audit(prisma: PrismaClient, entry: AuditEntry): void {
  prisma.auditLog
    .create({ data: { ...entry, actorId: entry.actorId ?? null, meta: entry.meta ?? {} } })
    .catch((err: unknown) => console.error('audit_log falló', err));
}
