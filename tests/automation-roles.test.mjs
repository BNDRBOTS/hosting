import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAutomationAccess } from '../src/db/authorization.ts';

const roles = ['INTAKE', 'IMPLEMENTER', 'VERIFIER', 'RISK', 'APPROVER', 'SHIPPER', 'WATCHER', 'ORCHESTRATOR'];
const previous = new Map(roles.map((role) => [`PROOFLOOP_${role}_KEY`, process.env[`PROOFLOOP_${role}_KEY`]]));

function restoreEnvironment() {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('automated pipeline roles require distinct private keys', async () => {
  try {
    for (const role of roles) process.env[`PROOFLOOP_${role}_KEY`] = `${role.toLowerCase()}-role-private-key-${'x'.repeat(32)}`;
    await requireAutomationAccess(process.env.PROOFLOOP_APPROVER_KEY, 'approver');
    await assert.rejects(() => requireAutomationAccess(process.env.PROOFLOOP_IMPLEMENTER_KEY, 'approver'), /not available/);
    process.env.PROOFLOOP_APPROVER_KEY = process.env.PROOFLOOP_IMPLEMENTER_KEY;
    await assert.rejects(() => requireAutomationAccess(process.env.PROOFLOOP_APPROVER_KEY, 'approver'), /separate role keys/);
  } finally {
    restoreEnvironment();
  }
});
