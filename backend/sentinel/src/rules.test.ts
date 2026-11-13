import { describe, expect, it } from 'vitest';
import { ipInSubnet, parseAccessLine, type AccessLine } from './parse';
import { detect } from './rules';

const line = (ip: string, path: string, status = 200) =>
  parseAccessLine(
    `${ip} - - [03/Nov/2026:10:00:00 -0600] "GET ${path} HTTP/1.1" ${status} 512 "-" "curl/8.0"`,
  ) as AccessLine;

describe('parseo de access.log', () => {
  it('lee el formato combined', () => {
    const l = line('10.147.20.15', '/api/health');
    expect(l).toMatchObject({
      ip: '10.147.20.15',
      method: 'GET',
      path: '/api/health',
      status: 200,
      bytes: 512,
      userAgent: 'curl/8.0',
    });
  });

  it('lee el formato common con bytes "-"', () => {
    const l = parseAccessLine('::1 - - [03/Nov/2026:10:00:00 -0600] "GET / HTTP/1.1" 304 -');
    expect(l).toMatchObject({ ip: '::1', status: 304, bytes: 0 });
  });

  it('ignora líneas que no son de acceso', () => {
    expect(parseAccessLine('[notice] AH00456: Apache Lounge VS18 Server built')).toBeNull();
  });
});

describe('subred ZeroTier', () => {
  it('reconoce IPs dentro y fuera de /24', () => {
    expect(ipInSubnet('10.147.20.200', '10.147.20.0/24')).toBe(true);
    expect(ipInSubnet('10.147.21.1', '10.147.20.0/24')).toBe(false);
    expect(ipInSubnet('::1', '10.147.20.0/24')).toBe(false);
  });
});

describe('reglas del sentinel', () => {
  it('no alerta tráfico normal de la red ZeroTier', () => {
    expect(detect([line('10.147.20.15', '/'), line('127.0.0.1', '/api/health')], [])).toEqual([]);
  });

  it('detecta path traversal codificado', () => {
    const [f] = detect([line('10.147.20.15', '/static/%2e%2e/%2e%2e/windows/win.ini', 403)], []);
    expect(f).toMatchObject({ category: 'path_traversal', severity: 'high' });
  });

  it('detecta inyección SQL y escaneo', () => {
    const cats = detect(
      [line('10.147.20.9', "/api/customers?q='%20or%201=1"), line('10.147.20.9', '/.env', 404)],
      [],
    ).map((f) => f.category);
    expect(cats).toEqual(expect.arrayContaining(['sql_injection', 'scanner']));
  });

  it('marca como crítico el tráfico fuera de la subred ZeroTier', () => {
    const [f] = detect([line('201.141.5.3', '/')], []);
    expect(f).toMatchObject({ category: 'outside_zerotier', severity: 'critical' });
  });

  it('detecta ráfagas de 4xx y fuerza bruta en el login', () => {
    const lines = Array.from({ length: 30 }, () => line('10.147.20.7', '/no-existe', 404));
    const findings = detect(lines, [{ ip: '10.147.20.8', count: 25 }]);
    expect(findings.find((f) => f.category === 'burst_4xx')?.count).toBe(30);
    expect(findings.find((f) => f.category === 'brute_force')?.severity).toBe('critical');
  });
});
