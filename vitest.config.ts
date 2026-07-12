import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Chrome tests cold-mount Blockly + CM6 in jsdom; under full-suite
    // parallelism the first mount in a file can exceed the 5 s default on
    // a loaded machine (flaky timeouts unrelated to test logic).
    testTimeout: 15_000,
  },
});
