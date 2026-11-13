import {
  computeAggregates,
  computeChurn,
  computeClv,
  type EngineEvent,
  type ProfileSignals,
} from '@cdp/engine';
import type { EventCategory } from '@cdp/shared';
import type { MergeStatus, Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient;

const HISTORY_DAYS = 365;

type StoredPayload = {
  properties?: Record<string, string | number | boolean | null>;
  context?: { ip?: string; userAgent?: string };
  deviceId?: string;
};

/** Recalcula agregados, CLV y churn de un perfil a partir de su último año de eventos. */
export async function recomputeProfile(prisma: PrismaClient | Tx, customerId: string, now = new Date()) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;

  const rows = await prisma.event.findMany({
    where: { customerId, occurredAt: { gte: new Date(now.getTime() - HISTORY_DAYS * 86_400_000) } },
    select: { category: true, name: true, occurredAt: true, payload: true },
    orderBy: { occurredAt: 'desc' },
    take: 5000,
  });
  const events: EngineEvent[] = rows.map((r) => ({
    category: r.category as EventCategory,
    name: r.name,
    occurredAt: r.occurredAt,
    properties: (r.payload as StoredPayload).properties ?? {},
  }));

  const base = computeAggregates(events, now);
  const tenureDays = Math.max(1, (now.getTime() - customer.firstSeen.getTime()) / 86_400_000);
  const clv = computeClv(base, tenureDays);
  const churnScore = computeChurn(base);
  const aggregates = { ...base, clv, churn_score: churnScore };

  return prisma.customer.update({
    where: { id: customerId },
    data: { aggregates, clv, churnScore },
  });
}

/** Señales para el matching probabilístico, sacadas de los eventos recientes del perfil. */
export async function loadSignals(prisma: PrismaClient | Tx, customerId: string): Promise<ProfileSignals> {
  const rows = await prisma.event.findMany({
    where: { customerId },
    select: { occurredAt: true, payload: true },
    orderBy: { occurredAt: 'desc' },
    take: 50,
  });
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const payloads = rows.map((r) => r.payload as StoredPayload);
  return {
    deviceIds: uniq(payloads.map((p) => p.deviceId)),
    ips: uniq(payloads.map((p) => p.context?.ip)),
    userAgents: uniq(payloads.map((p) => p.context?.userAgent)),
    lastSeen: rows[0]?.occurredAt.getTime() ?? 0,
    interests: uniq(payloads.map((p) => p.properties?.category?.toString())),
  };
}

/**
 * Fusiona loser dentro de winner: mueve identidades y eventos, combina traits (gana el valor del
 * perfil ganador) y borra el perfil perdedor. Queda registro en identity_merges.
 */
export async function mergeCustomers(
  tx: Tx,
  args: {
    winnerId: string;
    loserId: string;
    rule: string;
    score: number;
    reasons: string[];
    status: MergeStatus;
    decidedBy?: string;
    /** Si viene de una revisión pendiente, se actualiza ese registro en vez de crear otro. */
    mergeId?: string;
  },
) {
  const { winnerId, loserId } = args;
  if (winnerId === loserId) return;
  const [winner, loser] = await Promise.all([
    tx.customer.findUniqueOrThrow({ where: { id: winnerId } }),
    tx.customer.findUniqueOrThrow({ where: { id: loserId } }),
  ]);

  await tx.identity.updateMany({ where: { customerId: loserId }, data: { customerId: winnerId } });
  await tx.event.updateMany({ where: { customerId: loserId }, data: { customerId: winnerId } });
  await tx.customer.update({
    where: { id: winnerId },
    data: {
      traits: { ...(loser.traits as object), ...(winner.traits as object) },
      firstSeen: loser.firstSeen < winner.firstSeen ? loser.firstSeen : winner.firstSeen,
      lastSeen: loser.lastSeen > winner.lastSeen ? loser.lastSeen : winner.lastSeen,
    },
  });
  await tx.customer.delete({ where: { id: loserId } });
  if (args.mergeId) {
    await tx.identityMerge.update({
      where: { id: args.mergeId },
      data: { status: args.status, decidedBy: args.decidedBy ?? null, decidedAt: new Date() },
    });
    return;
  }
  await tx.identityMerge.create({
    data: {
      winnerId,
      loserId,
      rule: args.rule,
      score: args.score,
      reasons: args.reasons,
      status: args.status,
      decidedBy: args.decidedBy ?? null,
      decidedAt: new Date(),
    },
  });
}
