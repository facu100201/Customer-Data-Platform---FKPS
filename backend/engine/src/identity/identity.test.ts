import { describe, expect, it } from 'vitest';
import { resolveDeterministic } from './deterministic';
import { maskIdentifier, normalizeEmail, normalizePhone } from './normalize';
import { scoreMatch, type ProfileSignals } from './probabilistic';

describe('normalización', () => {
  it('unifica variantes de Gmail', () => {
    expect(normalizeEmail(' Ana.Lopez+promo@GMAIL.com ')).toBe('analopez@gmail.com');
  });

  it('respeta los puntos fuera de Gmail', () => {
    expect(normalizeEmail('ana.lopez@usb.edu.mx')).toBe('ana.lopez@usb.edu.mx');
  });

  it('lleva teléfonos de 10 dígitos a E.164 con +52', () => {
    expect(normalizePhone('(55) 1234-5678')).toBe('+525512345678');
    expect(normalizePhone('+1 415 555 0100')).toBe('+14155550100');
  });

  it('enmascara PII', () => {
    expect(maskIdentifier('email', 'analopez@gmail.com')).toBe('an***@gmail.com');
    expect(maskIdentifier('phone', '+525512345678')).toBe('+52******5678');
  });
});

describe('resolución determinista', () => {
  it('une la sesión anónima del teléfono, la compra en laptop y el ticket de soporte', () => {
    const groups = resolveDeterministic([
      { id: 'movil', identifiers: [{ type: 'cookie_id', value: 'c-1' }] },
      {
        id: 'laptop',
        identifiers: [
          { type: 'cookie_id', value: 'c-1' },
          { type: 'email', value: 'Ana@Correo.com' },
        ],
      },
      { id: 'soporte', identifiers: [{ type: 'email', value: 'ana@correo.com' }] },
      { id: 'otra', identifiers: [{ type: 'email', value: 'luis@correo.com' }] },
    ]);
    const sorted = groups.map((g) => g.sort()).sort((a, b) => b.length - a.length);
    expect(sorted).toEqual([['laptop', 'movil', 'soporte'], ['otra']]);
  });

  it('no une por device_id ni IP (son señales probabilísticas)', () => {
    const groups = resolveDeterministic([
      { id: 'a', identifiers: [{ type: 'device_id', value: 'd-1' }] },
      { id: 'b', identifiers: [{ type: 'device_id', value: 'd-1' }] },
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('matching probabilístico', () => {
  const base: ProfileSignals = {
    deviceIds: ['d-1'],
    ips: ['10.147.20.15'],
    userAgents: ['Mozilla/5.0 Android'],
    lastSeen: Date.parse('2026-11-02T10:00:00Z'),
    interests: ['tenis', 'running'],
  };

  it('fusiona automáticamente con device + IP + user-agent + ventana de tiempo', () => {
    const r = scoreMatch(base, { ...base, interests: [] });
    expect(r.score).toBeGreaterThanOrEqual(0.85);
    expect(r.decision).toBe('auto_merge');
  });

  it('manda a revisión cuando solo coinciden dispositivo y user-agent', () => {
    const r = scoreMatch(base, { ...base, ips: ['192.168.1.9'], interests: [] });
    expect(r.decision).toBe('review');
  });

  it('descarta coincidencias débiles', () => {
    const r = scoreMatch(base, {
      deviceIds: ['d-2'],
      ips: ['10.147.20.99'],
      userAgents: ['Safari'],
      lastSeen: base.lastSeen + 86_400_000,
      interests: ['cocina'],
    });
    expect(r.decision).toBe('no_match');
    expect(r.reasons).toEqual(['misma subred /24']);
  });
});
