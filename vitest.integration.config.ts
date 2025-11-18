import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/unit/**'],
    testTimeout: 60000, // 60s for integration tests (real API calls)
    hookTimeout: 60000,
    // Run integration tests sequentially to avoid API rate limits
    threads: false,
    isolate: true,
  },
});
