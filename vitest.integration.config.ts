import path from 'path';
import {defineConfig} from 'vitest/config';

/**
 * The integration suite: `api/` handlers called in-process against the RUNNING local
 * Supabase stack (`make db-start`), with real Auth, RLS and RPCs — only the model is
 * mocked. `make api-test` exports the stack's URL and keys and runs this config;
 * `vitest.config.ts` excludes `*.int.test.ts` so `npm test` stays hermetic.
 *
 * Files run one at a time: they share one database and clean up after themselves, but
 * the per-user model budget is a clock-hour counter and two files racing on one
 * anonymous session would see each other's calls.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
