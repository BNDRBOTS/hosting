import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaryPlugin from './scripts/eslint-plugin-proofloop-boundaries.mjs';

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'src/db/migrations/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/features/**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    plugins: { proofloop: boundaryPlugin },
    rules: { 'proofloop/no-cross-feature-imports': 'error' },
  },
);
