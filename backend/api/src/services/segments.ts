import { evaluateRule, type ProfileAggregates } from '@cdp/engine';
import { ruleSchema, type Rule } from '@cdp/shared';
import type { PrismaClient } from '@prisma/client';

const PAGE = 1000;

/**
 * Evalúa la regla sobre todos los perfiles, por páginas ordenadas por id. Solo lee: no toca la
 * membresía ni el segmento. `total` es cuántos perfiles se evaluaron.
 */
export async function matchCustomers(
  prisma: PrismaClient,
  rule: Rule,
): Promise<{ members: string[]; total: number }> {
  const members: string[] = [];
  let total = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.customer.findMany({
      select: { id: true, aggregates: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });
    total += page.length;
    for (const c of page) {
      if (evaluateRule(rule, c.aggregates as ProfileAggregates)) members.push(c.id);
    }
    if (page.length < PAGE) break;
    cursor = page[page.length - 1]?.id;
  }
  return { members, total };
}

/** Vista previa: cuántos perfiles cumplirían la regla, sin guardar nada. */
export async function previewSegment(
  prisma: PrismaClient,
  rule: Rule,
): Promise<{ matches: number; total: number }> {
  const { members, total } = await matchCustomers(prisma, rule);
  return { matches: members.length, total };
}

/** Re-evalúa la regla del segmento sobre todos los perfiles y reemplaza la membresía. */
export async function refreshSegment(prisma: PrismaClient, segmentId: string): Promise<number> {
  const segment = await prisma.segment.findUniqueOrThrow({ where: { id: segmentId } });
  const rule = ruleSchema.parse(segment.definition);
  const { members } = await matchCustomers(prisma, rule);

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
