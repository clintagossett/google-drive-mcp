import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'dist/**',
        'scripts/**',
        '**/*.config.ts',
        'tests/**',
        'node_modules/**',
      ],
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
    testTimeout: 15000, // 15s for unit tests (allows for API calls)
    hookTimeout: 30000, // 30s for hooks (allows for MCP client creation + auth)
  },
});
