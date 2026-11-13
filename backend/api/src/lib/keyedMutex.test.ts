import { describe, expect, it } from 'vitest';
import { KeyedMutex } from './keyedMutex';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('KeyedMutex', () => {
  it('serializa tareas con la misma llave', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    await Promise.all([
      mutex.run(['a'], async () => {
        order.push('1-inicio');
        await tick();
        order.push('1-fin');
      }),
      mutex.run(['a'], async () => {
        order.push('2-inicio');
      }),
    ]);
    expect(order).toEqual(['1-inicio', '1-fin', '2-inicio']);
    expect(mutex.pending).toBe(0);
  });

  it('deja correr en paralelo llaves distintas', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    await Promise.all([
      mutex.run(['a'], async () => {
        await tick();
        order.push('a');
      }),
      mutex.run(['b'], async () => {
        order.push('b');
      }),
    ]);
    expect(order).toEqual(['b', 'a']);
  });

  it('no se bloquea con llaves cruzadas', async () => {
    const mutex = new KeyedMutex();
    const results = await Promise.all([
      mutex.run(['x', 'y'], async () => 1),
      mutex.run(['y', 'x'], async () => 2),
    ]);
    expect(results).toEqual([1, 2]);
  });

  it('libera la llave aunque la tarea falle', async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run(['a'], async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(mutex.run(['a'], async () => 'ok')).resolves.toBe('ok');
  });
});
