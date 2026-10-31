import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRisk } from '../src/features/risk/classification.ts';

test('routine changes remain routine under both size limits', () => {
  assert.equal(classifyRisk({ changedFiles: ['src/page.tsx'], changedLines: 400 }), 'routine');
  assert.equal(classifyRisk({ changedFiles: Array(10).fill('src/page.tsx'), changedLines: 12 }), 'routine');
});

test('authentication, payments, deletion, and migration paths are high risk', () => {
  for (const path of [
    'src/auth/login.ts',
    'src/features/accounts/sign-in.ts',
    'src/payments/checkout.ts',
    'src/actions/delete-user-data.ts',
    'src/db/migrations/0001.sql',
  ]) {
    assert.equal(classifyRisk({ changedFiles: [path], changedLines: 1 }), 'high', path);
  }
});

test('large changes are high risk at the specified thresholds', () => {
  assert.equal(classifyRisk({ changedFiles: Array(11).fill('src/page.tsx'), changedLines: 1 }), 'high');
  assert.equal(classifyRisk({ changedFiles: ['src/page.tsx'], changedLines: 401 }), 'high');
});

test('invalid changed-line counts are rejected', () => {
  assert.throws(() => classifyRisk({ changedFiles: [], changedLines: -1 }), RangeError);
  assert.throws(() => classifyRisk({ changedFiles: [], changedLines: 1.5 }), RangeError);
});
