import { evaluateRule, type ProfileAggregates } from '@cdp/engine';
import { ruleSchema } from '@cdp/shared';
import type { PrismaClient } from '@prisma/client';

const PAGE = 1000;

/** Re-evalúa la regla del segmento sobre todos los perfiles y reemplaza la membresía. */
export async function refreshSegment(prisma: PrismaClient, segmentId: string): Promise<number> {
  const segment = await prisma.segment.findUniqueOrThrow({ where: { id: segmentId } });
  const rule = ruleSchema.parse(segment.definition);

  const members: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.customer.findMany({
      select: { id: true, aggregates: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });
    for (const c of page) {
      if (evaluateRule(rule, c.aggregates as ProfileAggregates)) members.push(c.id);
    }
    if (page.length < PAGE) break;
    cursor = page[page.length - 1]?.id;
  }

  await prisma.$transaction([
    prisma.segmentMembership.deleteMany({ where: { segmentId } }),
    prisma.segmentMembership.createMany({ data: members.map((customerId) => ({ segmentId, customerId })) }),
    prisma.segment.update({ where: { id: segmentId }, data: { refreshedAt: new Date() } }),
  ]);
  return members.length;
}

/**
 * Ejecuta una activación. Los destinos son simulados: el CDP decide a quién y qué mandar, y deja
 * el resultado registrado; no se conecta con HubSpot, Meta Ads ni otros servicios reales.
 */
export async function runActivation(prisma: PrismaClient, activationId: string) {
  const activation = await prisma.activation.findUniqueOrThrow({ where: { id: activationId } });
  const audience = await prisma.segmentMembership.count({ where: { segmentId: activation.segmentId } });
  const sample = await prisma.segmentMembership.findMany({
    where: { segmentId: activation.segmentId },
    select: { customerId: true },
    take: 5,
  });
  const result = {
    destination: activation.destination,
    audience,
    sample: sample.map((s) => s.customerId),
    simulated: true,
    at: new Date().toISOString(),
  };
  return prisma.activation.update({
    where: { id: activationId },
    data: { status: 'done', lastRun: new Date(), lastResult: result },
  });
}
