import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO } from './scenario';
import { NAME_MAX, findByName, normalizeName, sameName, type StoredScenario } from './scenarioStore';

// El acceso a IndexedDB se prueba en el navegador (e2e/simulator.spec.ts); aquí, las reglas de nombres.
describe('nombres de escenarios', () => {
  it('limpia espacios y limita el largo', () => {
    expect(normalizeName('  Retención   agresiva \n')).toBe('Retención agresiva');
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('x'.repeat(200))).toHaveLength(NAME_MAX);
  });

  it('compara sin importar mayúsculas ni espacios extra', () => {
    expect(sameName('Retención agresiva', '  retención   AGRESIVA')).toBe(true);
    expect(sameName('Retención', 'Retencion')).toBe(false);
  });

  it('encuentra el escenario existente con el mismo nombre', () => {
    const items: StoredScenario[] = [
      { id: 1, name: 'Base', createdAt: 1, params: DEFAULT_SCENARIO },
      { id: 2, name: 'Margen alto', createdAt: 2, params: DEFAULT_SCENARIO },
    ];
    expect(findByName(items, 'margen ALTO')?.id).toBe(2);
    expect(findByName(items, 'Otro')).toBeUndefined();
  });
});
