import { eventSchema } from '@cdp/shared';
import { describe, expect, it } from 'vitest';
import { journey, makePersonas, rng } from './journeys';

describe('simulador de terminales', () => {
  const now = new Date('2026-11-02T12:00:00Z');

  it('es reproducible con la misma semilla', () => {
    expect(makePersonas(3, 7)).toEqual(makePersonas(3, 7));
  });

  it('genera eventos que pasan el esquema de ingesta', () => {
    const personas = makePersonas(30, 42);
    const events = personas.flatMap((p, i) => journey(p, `sim-${i}`, now, rng(i)));
    const invalid = events.filter((e) => !eventSchema.safeParse(e).success);
    expect(invalid).toEqual([]);
    expect(events.length).toBeGreaterThan(100);
  });

  it('las personas con dos dispositivos se identifican con el mismo email en ambos', () => {
    const persona = makePersonas(50, 1).find((p) => p.devices.length === 2)!;
    const events = journey(persona, 'sim-01', now, rng(3));
    const identified = new Set(events.filter((e) => e.identifiers?.email === persona.email).map((e) => e.anonymousId));
    expect(identified.size).toBe(2);
  });

  it('nunca genera eventos en el futuro', () => {
    const events = makePersonas(10, 9).flatMap((p) => journey(p, 'sim', now, rng(5)));
    expect(events.every((e) => new Date(e.occurredAt) <= now)).toBe(true);
  });
});
