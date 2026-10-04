import { defineConfig } from 'vitest/config';

/**
 * Unit tests cover `src/shared/` only — the pure logic both processes import.
 *
 * Anything that opens the database cannot run here: `better-sqlite3` is a
 * native module built against Electron's ABI, not plain Node's, so importing it
 * under Vitest fails with NODE_MODULE_VERSION mismatch. Those checks live in
 * `scripts/integration/` and run under Electron via `npm run test:integration`.
 */
export default defineConfig({
  test: {
    include: ['src/shared/**/*.test.ts'],
    environment: 'node',
  },
});
