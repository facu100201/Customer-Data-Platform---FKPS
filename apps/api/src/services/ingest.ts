import {
  DETERMINISTIC_TYPES,
  maskIdentifier,
  normalizeIdentifier,
  scoreMatch,
  type IdentifierType,
} from '@cdp/engine';
import type { CdpEvent, Identifiers } from '@cdp/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { hashIdentifier } from '../lib/crypto';
import { KeyedMutex } from '../lib/keyedMutex';
import { loadSignals, mergeCustomers, recomputeProfile } from './profiles';

const KEY_TO_TYPE: Record<keyof Identifiers, IdentifierType> = {
  email: 'email',
  phone: 'phone',
  crmId: 'crm_id',
  deviceId: 'device_id',
  cookieId: 'cookie_id',
};

export type IngestContext = {
  pepper: string;
  sourceId?: string;
  requestIp?: string;
  /** Eventos del simulador o de QA: el perfil se marca como sintético. */
  synthetic: boolean;
};

export type IngestResult = {
  customerId: string;
  created: boolean;
  duplicate: boolean;
  merged: string[];
  pendingReview: string[];
};

type HashedIdentifier = { type: IdentifierType; hash: string; masked: string };

const mutex = new KeyedMutex();

export function hashIdentifiers(event: CdpEvent, ctx: IngestContext): HashedIdentifier[] {
  const raw: { type: IdentifierType; value: string }[] = [{ type: 'cookie_id', value: event.anonymousId }];
  for (const [key, value] of Object.entries(event.identifiers) as [keyof Identifiers, string | undefined][]) {
    if (value) raw.push({ type: KEY_TO_TYPE[key], value });
  }
  const ip = event.context.ip ?? ctx.requestIp;
  if (ip) raw.push({ type: 'ip', value: ip });

  const seen = new Set<string>();
  const out: HashedIdentifier[] = [];
  for (const { type, value } of raw) {
    const normalized = normalizeIdentifier(type, value);
    const hash = hashIdentifier(ctx.pepper, type, normalized);
    if (seen.has(`${type}:${hash}`)) continue;
    seen.add(`${type}:${hash}`);
    out.push({ type, hash, masked: maskIdentifier(type, normalized) });
  }
  return out;
}

/**
 * Ingesta un evento: resuelve la identidad (determinista y luego probabilística), guarda el evento
 * y recalcula el perfil. Devuelve qué perfil quedó y qué fusiones ocurrieron.
 */
export async function ingestEvent(prisma: PrismaClient, event: CdpEvent, ctx: IngestContext): Promise<IngestResult> {
  const ids = hashIdentifiers(event, ctx);
  const deterministic = ids.filter((i) => DETERMINISTIC_TYPES.has(i.type));
  const occurredAt = new Date(event.occurredAt);

  return mutex.run(
    deterministic.map((i) => i.hash),
    async () => {
      const base = await prisma.$transaction(async (tx) => {
        if (event.eventId) {
          const dup = await tx.event.findUnique({ where: { eventId: event.eventId }, select: { customerId: true } });
          if (dup?.customerId) {
            return { customerId: dup.customerId, created: false, duplicate: true, merged: [] as string[] };
          }
        }

        const owners = await tx.identity.findMany({
          where: { OR: deterministic.map((i) => ({ type: i.type, valueHash: i.hash })) },
          select: { customerId: true, customer: { select: { firstSeen: true } } },
        });
        const ownerIds = [...new Map(owners.map((o) => [o.customerId, o.customer.firstSeen])).entries()]
          .sort((a, b) => a[1].getTime() - b[1].getTime())
          .map(([id]) => id);

        let customerId: string;
        let created = false;
        const merged: string[] = [];
        const [oldest, ...rest] = ownerIds;
        if (!oldest) {
          const customer = await tx.customer.create({
            data: { synthetic: ctx.synthetic, firstSeen: occurredAt, lastSeen: occurredAt },
          });
          customerId = customer.id;
          created = true;
        } else {
          customerId = oldest;
          for (const loserId of rest) {
            await mergeCustomers(tx, {
              winnerId: customerId,
              loserId,
              rule: 'deterministic',
              score: 1,
              reasons: ['comparten un identificador determinista'],
              status: 'auto',
            });
            merged.push(loserId);
          }
        }

        await tx.identity.createMany({
          data: ids.map((i) => ({
            customerId,
            type: i.type,
            valueHash: i.hash,
            valueMasked: i.masked,
            confidence: DETERMINISTIC_TYPES.has(i.type) ? 1 : 0.5,
            source: ctx.sourceId ?? 'terminal',
          })),
          skipDuplicates: true,
        });

        await tx.event.create({
          data: {
            eventId: event.eventId ?? null,
            category: event.category,
            name: event.name,
            anonymousId: event.anonymousId,
            customerId,
            sourceId: ctx.sourceId ?? null,
            terminalId: event.terminalId ?? null,
            occurredAt,
            payload: {
              properties: event.properties,
              context: { ...event.context, ip: event.context.ip ?? ctx.requestIp },
              deviceId: event.identifiers.deviceId,
            } as Prisma.InputJsonValue,
          },
        });

        const current = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
        await tx.customer.update({
          where: { id: customerId },
          data: {
            lastSeen: occurredAt > current.lastSeen ? occurredAt : current.lastSeen,
            ...(event.category === 'profile' && {
              traits: { ...(current.traits as object), ...event.properties },
            }),
          },
        });

        return { customerId, created, duplicate: false, merged };
      });

      if (base.duplicate) return { ...base, pendingReview: [] };

      // Un perfil nuevo y anónimo (solo cookie) se compara con quienes comparten dispositivo o IP
      let { customerId } = base;
      const pendingReview: string[] = [];
      const anonymous = deterministic.every((i) => i.type === 'cookie_id');
      if (base.created && anonymous) {
        const probabilistic = ids.filter((i) => i.type === 'device_id' || i.type === 'ip');
        const candidates = probabilistic.length
          ? await prisma.identity.findMany({
              where: {
                OR: probabilistic.map((i) => ({ type: i.type, valueHash: i.hash })),
                customerId: { not: customerId },
              },
              select: { customerId: true },
              distinct: ['customerId'],
              take: 5,
            })
          : [];
        const mine = await loadSignals(prisma, customerId);
        for (const { customerId: candidateId } of candidates) {
          const result = scoreMatch(mine, await loadSignals(prisma, candidateId));
          if (result.decision === 'auto_merge') {
            await prisma.$transaction((tx) =>
              mergeCustomers(tx, {
                winnerId: candidateId,
                loserId: customerId,
                rule: 'probabilistic',
                score: result.score,
                reasons: result.reasons,
                status: 'auto',
              }),
            );
            base.merged.push(customerId);
            customerId = candidateId;
            break;
          }
          if (result.decision === 'review') {
            const merge = await prisma.identityMerge.create({
              data: {
                winnerId: candidateId,
                loserId: customerId,
                rule: 'probabilistic',
                score: result.score,
                reasons: result.reasons,
                status: 'pending',
              },
            });
            pendingReview.push(merge.id);
          }
        }
      }

      await recomputeProfile(prisma, customerId);
      return { ...base, customerId, pendingReview };
    },
  );
}
