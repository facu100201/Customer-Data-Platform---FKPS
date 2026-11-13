export type ProfileSignals = {
  deviceIds: string[];
  ips: string[];
  userAgents: string[];
  /** Último evento, en milisegundos epoch. */
  lastSeen: number;
  /** Categorías o productos vistos; se comparan con Jaccard. */
  interests: string[];
};

export const MATCH_WEIGHTS = {
  device: 0.45,
  ipExact: 0.2,
  ipSubnet: 0.1,
  userAgent: 0.1,
  time: 0.1,
  behavior: 0.15,
} as const;

export const AUTO_MERGE_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.6;
const TIME_WINDOW_MS = 30 * 60 * 1000;

export type MatchDecision = 'auto_merge' | 'review' | 'no_match';
export type MatchResult = { score: number; decision: MatchDecision; reasons: string[] };

const intersects = (a: string[], b: string[]) => a.some((x) => b.includes(x));

const subnet24 = (ip: string) => (ip.includes('.') ? ip.split('.').slice(0, 3).join('.') : ip);

export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Puntaje 0–1 de que dos perfiles sean la misma persona. Ningún factor aislado alcanza el umbral
 * de merge automático: hacen falta al menos dos señales fuertes (p. ej. device + IP + user-agent).
 */
export function scoreMatch(a: ProfileSignals, b: ProfileSignals): MatchResult {
  let score = 0;
  const reasons: string[] = [];

  if (intersects(a.deviceIds, b.deviceIds)) {
    score += MATCH_WEIGHTS.device;
    reasons.push('mismo device_id');
  }
  if (intersects(a.ips, b.ips)) {
    score += MATCH_WEIGHTS.ipExact;
    reasons.push('misma IP');
  } else if (intersects(a.ips.map(subnet24), b.ips.map(subnet24))) {
    score += MATCH_WEIGHTS.ipSubnet;
    reasons.push('misma subred /24');
  }
  if (intersects(a.userAgents, b.userAgents)) {
    score += MATCH_WEIGHTS.userAgent;
    reasons.push('mismo user-agent');
  }
  if (Math.abs(a.lastSeen - b.lastSeen) <= TIME_WINDOW_MS) {
    score += MATCH_WEIGHTS.time;
    reasons.push('actividad en la misma ventana de 30 min');
  }
  const behavior = jaccard(a.interests, b.interests);
  if (behavior > 0) {
    score += MATCH_WEIGHTS.behavior * behavior;
    reasons.push(`intereses similares (Jaccard ${behavior.toFixed(2)})`);
  }

  score = Math.min(1, Number(score.toFixed(4)));
  const decision: MatchDecision =
    score >= AUTO_MERGE_THRESHOLD ? 'auto_merge' : score >= REVIEW_THRESHOLD ? 'review' : 'no_match';
  return { score, decision, reasons };
}
