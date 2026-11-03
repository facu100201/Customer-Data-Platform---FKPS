import { ipInSubnet, isLoopback, type AccessLine } from './parse';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type Finding = {
  category: string;
  severity: Severity;
  ip: string;
  count: number;
  excerpt: string[];
};

const PATTERNS: { category: string; severity: Severity; re: RegExp }[] = [
  { category: 'path_traversal', severity: 'high', re: /(\.\.\/|\.\.\\|%2e%2e(%2f|%5c|\/))/i },
  { category: 'sql_injection', severity: 'high', re: /(union(\s|%20|\+)+select|'(\s|%20)*or(\s|%20)+1=1|sleep\(|information_schema)/i },
  { category: 'xss', severity: 'medium', re: /(<script|%3cscript|javascript:|onerror=)/i },
  { category: 'scanner', severity: 'medium', re: /\/(wp-admin|wp-login|phpmyadmin|\.env|\.git\/|cgi-bin|server-status)/i },
];

export type RuleOptions = {
  ztSubnet: string;
  burst4xx: number;
  burst5xx: number;
  failedLogins: number;
};

export const DEFAULT_RULES: RuleOptions = { ztSubnet: '10.147.20.0/24', burst4xx: 30, burst5xx: 10, failedLogins: 5 };

/**
 * Prefiltro barato y determinista. Solo lo que sale de aquí se manda a Ollama, para no gastar el
 * modelo en tráfico normal y para tener alertas aunque Ollama esté apagado.
 */
export function detect(
  lines: AccessLine[],
  failedLogins: { ip: string | null; count: number }[],
  opts: RuleOptions = DEFAULT_RULES,
): Finding[] {
  const found = new Map<string, Finding>();
  const add = (category: string, severity: Severity, line: AccessLine) => {
    const key = `${category}|${line.ip}`;
    const f = found.get(key) ?? { category, severity, ip: line.ip, count: 0, excerpt: [] };
    f.count++;
    if (f.excerpt.length < 5) f.excerpt.push(line.raw);
    found.set(key, f);
  };

  const per4xx = new Map<string, AccessLine[]>();
  const per5xx = new Map<string, AccessLine[]>();
  for (const line of lines) {
    let decoded = line.path;
    try {
      decoded = decodeURIComponent(line.path);
    } catch {
      // una URL mal codificada ya es sospechosa; se evalúa tal cual
    }
    for (const p of PATTERNS) {
      if (p.re.test(line.path) || p.re.test(decoded)) add(p.category, p.severity, line);
    }
    if (!isLoopback(line.ip) && !ipInSubnet(line.ip, opts.ztSubnet)) add('outside_zerotier', 'critical', line);
    if (line.status >= 400 && line.status < 500) per4xx.set(line.ip, [...(per4xx.get(line.ip) ?? []), line]);
    if (line.status >= 500) per5xx.set(line.ip, [...(per5xx.get(line.ip) ?? []), line]);
  }

  for (const [ip, ls] of per4xx) {
    if (ls.length >= opts.burst4xx) {
      found.set(`burst_4xx|${ip}`, { category: 'burst_4xx', severity: 'medium', ip, count: ls.length, excerpt: ls.slice(0, 5).map((l) => l.raw) });
    }
  }
  for (const [ip, ls] of per5xx) {
    if (ls.length >= opts.burst5xx) {
      found.set(`burst_5xx|${ip}`, { category: 'burst_5xx', severity: 'high', ip, count: ls.length, excerpt: ls.slice(0, 5).map((l) => l.raw) });
    }
  }
  for (const { ip, count } of failedLogins) {
    if (count >= opts.failedLogins) {
      found.set(`brute_force|${ip}`, {
        category: 'brute_force',
        severity: count >= opts.failedLogins * 4 ? 'critical' : 'high',
        ip: ip ?? 'desconocida',
        count,
        excerpt: [`${count} logins fallidos en la ventana`],
      });
    }
  }
  return [...found.values()];
}
