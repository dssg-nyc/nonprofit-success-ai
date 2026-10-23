import path from 'path';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    // Integration tests need the local Supabase stack: vitest.integration.config.ts (`make api-test`).
    exclude: ['**/node_modules/**', '**/*.int.test.ts'],
    // The judge verdict cache is a file under reports/output; tests opt in with setJudgeCache().
    env: { EVAL_JUDGE_CACHE: '0' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
