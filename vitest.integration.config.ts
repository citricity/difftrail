/**
 * The integration suite runs a browser, so it is kept apart from `pnpm test`:
 * unit tests should stay fast and need nothing installed beyond node_modules.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No jsdom here — the point is a real browser and a real layout.
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // Building the app and launching a browser is not a five-second affair.
    testTimeout: 60000,
    hookTimeout: 180000,
    // One browser, one build, shared by the file's tests.
    fileParallelism: false,
  },
});
