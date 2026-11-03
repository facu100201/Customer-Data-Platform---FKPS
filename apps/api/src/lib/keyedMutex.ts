/**
 * Candado en memoria por llave. La API corre como un solo proceso detrás de Apache, así que basta
 * para que dos eventos simultáneos del mismo visitante no creen dos perfiles.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async run<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    // orden fijo para que dos llamadas con las mismas llaves no se bloqueen entre sí
    const sorted = [...new Set(keys)].sort();
    const releases: (() => void)[] = [];
    for (const key of sorted) {
      const prev = this.tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const tail = prev.then(() => gate);
      this.tails.set(key, tail);
      await prev;
      releases.push(() => {
        release();
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    }
    try {
      return await fn();
    } finally {
      for (const r of releases) r();
    }
  }

  get pending(): number {
    return this.tails.size;
  }
}
