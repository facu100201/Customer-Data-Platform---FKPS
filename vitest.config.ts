import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'simulators/*/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/api/src/**', 'apps/sentinel/src/**'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
