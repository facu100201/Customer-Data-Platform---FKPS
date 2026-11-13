import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'backend/*/src/**/*.test.ts', 'frontend/*/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['shared/src/**', 'backend/engine/src/**', 'backend/api/src/**', 'backend/sentinel/src/**'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
