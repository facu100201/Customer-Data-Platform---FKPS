import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // los paquetes del monorepo se publican como TS fuente; se empaquetan dentro del build
  noExternal: [/^@cdp\//],
});
