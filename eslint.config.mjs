import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

const webFiles = ['apps/web/**/*.{ts,tsx,mjs}'];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**', '**/.next/**', '**/dist/**',
    '**/src/generated/**', '**/next-env.d.ts',
  ]),
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs', 'apps/web/next.config.mjs'],
    extends: [js.configs.recommended],
  },
  {
    files: ['apps/api/**/*.ts', 'apps/web/**/*.{ts,tsx}', 'tests/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    files: webFiles,
    extends: [nextPlugin.configs['core-web-vitals']],
    settings: { next: { rootDir: 'apps/web/' } },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@disc/api', '@disc/api/*', '**/api/**', '**/disc-assessment-seed.json', '**/reference/**'],
          message: 'Assessment source, mappings and scoring belong only in the Express API.',
        }],
      }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'apps/api/**/*.ts', 'apps/web/next.config.mjs', 'tests/**/*.{ts,mjs}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly' },
    },
  },
]);
