export type AccessLine = {
  ip: string;
  time: string;
  method: string;
  path: string;
  status: number;
  bytes: number;
  userAgent?: string;
  raw: string;
};

// Formatos "common" y "combined" de Apache: %h %l %u %t "%r" %>s %b ["%{Referer}i" "%{User-agent}i"]
const ACCESS_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\d+|-)(?: "[^"]*" "([^"]*)")?/;

export function parseAccessLine(raw: string): AccessLine | null {
  const m = ACCESS_RE.exec(raw);
  if (!m) return null;
  const [, ip = '', time = '', method = '', path = '', status = '0', bytes = '-', userAgent] = m;
  return {
    ip,
    time,
    method,
    path,
    status: Number(status),
    bytes: bytes === '-' ? 0 : Number(bytes),
    userAgent,
    raw,
  };
}

export function ipInSubnet(ip: string, cidr: string): boolean {
  const [base = '', bitsText = '32'] = cidr.split('/');
  const toInt = (v: string) => v.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const bits = Number(bitsText);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(base) & mask);
}

export const isLoopback = (ip: string) => ip === '::1' || ip.startsWith('127.');
