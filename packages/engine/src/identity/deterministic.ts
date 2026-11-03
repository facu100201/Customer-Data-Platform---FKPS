import { DETERMINISTIC_TYPES, normalizeIdentifier, type IdentifierType } from './normalize';
import { UnionFind } from './unionFind';

export type Identifier = { type: IdentifierType; value: string };
export type Fragment = { id: string; identifiers: Identifier[] };

/**
 * Agrupa fragmentos (sesiones, registros de CRM, tickets) que comparten al menos un identificador
 * determinista. Devuelve grupos de ids de fragmento; cada grupo es una persona.
 */
export function resolveDeterministic(fragments: Fragment[]): string[][] {
  const uf = new UnionFind<string>();
  const owner = new Map<string, string>();

  for (const fragment of fragments) {
    uf.add(fragment.id);
    for (const { type, value } of fragment.identifiers) {
      if (!DETERMINISTIC_TYPES.has(type)) continue;
      const key = `${type}:${normalizeIdentifier(type, value)}`;
      const seen = owner.get(key);
      if (seen) uf.union(seen, fragment.id);
      else owner.set(key, fragment.id);
    }
  }
  return uf.groups();
}
