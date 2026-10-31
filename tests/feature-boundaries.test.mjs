import test from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import boundaryPlugin from '../scripts/eslint-plugin-proofloop-boundaries.mjs';
import tseslint from 'typescript-eslint';

const linter = new Linter({ configType: 'flat' });
const config = [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser }, plugins: { proofloop: boundaryPlugin }, rules: { 'proofloop/no-cross-feature-imports': 'error' } }];
const accountFile = `${process.cwd()}/src/features/accounts/actions/example.ts`;

function messages(code) {
  return linter.verify(code, config, { filename: accountFile });
}

test('feature import rule rejects relative and aliased cross-feature imports', () => {
  assert.equal(messages("import { x } from '../../projects/queries/list';").length, 1);
  assert.equal(messages("export * from '@/features/projects/queries/list';").length, 1);
  assert.equal(messages("const project = require('../../projects/project');").length, 1);
  assert.equal(messages("import type { Project } from '@/features/projects/schema/project';").length, 1);
  assert.equal(messages("import('@/features/' + featureName);").length, 1);
  assert.equal(messages("import { page } from '../../../app/page';").length, 1);
});

test('feature import rule permits same-feature, shared, and database imports', () => {
  assert.equal(messages("import { x } from '../schema/account';").length, 0);
  assert.equal(messages("import { x } from '@/lib/crypto';").length, 0);
  assert.equal(messages("import { db } from '@/db/client';").length, 0);
});
