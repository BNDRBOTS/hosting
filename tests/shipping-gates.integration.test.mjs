import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Algorithm, hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { encryptStoredValue } from '../src/lib/crypto.ts';

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://proofloop:proofloop@localhost:5432/proofloop' });
after(async () => pool.end());
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const testPasswordHash = await hash('a-long-password-for-database-gate-tests', { algorithm: Algorithm.Argon2id });
if (!process.env.PROOFLOOP_MASTER_KEY) process.env.PROOFLOOP_MASTER_KEY = Buffer.alloc(32, 42).toString('base64');

async function addVerification(client, agentRunId, projectId, status, sha, evidenceRoot) {
  const claimId = `claim-${randomUUID()}`;
  const run = await client.query(
    `INSERT INTO verification_runs (agent_run_id, project_id, status, report)
     VALUES ($1, $2, 'running', $3::jsonb) RETURNING id`,
    [agentRunId, projectId, JSON.stringify({ assertions: [{ name: 'screen loads', passed: status === 'passed' }], claims: [{ id: claimId, statement: 'The welcome heading is visible.' }] })],
  );
  const id = run.rows[0].id;
  const fileName = `${randomUUID()}.json`;
  await writeFile(path.join(evidenceRoot, fileName), JSON.stringify({ captured: true, status }));
  const artifact = await client.query(
    'INSERT INTO evidence_artifacts (verification_run_id, kind, storage_path) VALUES ($1, $2, $3) RETURNING id',
    [id, 'log', fileName],
  );
  await client.query(
    `UPDATE verification_runs SET status = $2, verified_sha = $3, ended_at = now(), updated_at = now() WHERE id = $1`,
    [id, status, sha],
  );
  return { id, artifactId: artifact.rows[0].id, claimId };
}

async function createShippingFixture(client, scenario) {
  const userId = randomUUID();
  const connectionId = randomUUID();
  const projectId = randomUUID();
  const changeRequestId = randomUUID();
  const requirementId = randomUUID();
  const agentRunId = randomUUID();
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), 'proofloop-gate-evidence-'));
  await client.query('BEGIN');
  await client.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [userId, `${userId}@proofloop.test`, testPasswordHash]);
  const githubCredential = encryptStoredValue(`test-github-credential-${userId}`);
  await client.query(
    `INSERT INTO github_connections (id, user_id, github_account_id, ciphertext, nonce, authentication_tag)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [connectionId, userId, `github-${userId}`, githubCredential.ciphertext, githubCredential.nonce, githubCredential.authenticationTag],
  );
  await client.query(
    `INSERT INTO projects (id, github_connection_id, github_repo_id, default_branch, name)
     VALUES ($1, $2, $3, 'main', 'Gate test project')`,
    [projectId, connectionId, `repo-${projectId}`],
  );
  await client.query('INSERT INTO change_requests (id, project_id, request_text) VALUES ($1, $2, $3)', [changeRequestId, projectId, 'Show the welcome heading.']);
  await client.query(
    'INSERT INTO requirements (id, change_request_id, text, status) VALUES ($1, $2, $3, $4)',
    [requirementId, changeRequestId, 'The welcome heading is visible.', scenario === 'unevidenced requirement' ? 'unevidenced' : 'evidenced'],
  );
  await client.query(
    `INSERT INTO risk_assessments (change_request_id, tier, reasons, footprint, computed_by)
     VALUES ($1, 'routine', '[]'::jsonb, '{"changedFiles":[],"changedLines":0}'::jsonb, 'rules')`,
    [changeRequestId],
  );
  await client.query("UPDATE change_requests SET status = 'implementing' WHERE id = $1", [changeRequestId]);
  await client.query(
    `INSERT INTO agent_runs (id, change_request_id, sandbox_id, status, attempt_number)
     VALUES ($1, $2, $3, 'running', 1)`,
    [agentRunId, changeRequestId, `sandbox-${agentRunId}`],
  );
  await client.query("UPDATE agent_runs SET status = 'passed', ended_at = now() WHERE id = $1", [agentRunId]);
  await client.query("UPDATE change_requests SET status = 'verifying' WHERE id = $1", [changeRequestId]);
  const runStatus = scenario === 'failing verification' ? 'failed' : 'passed';
  const mainRun = await addVerification(client, agentRunId, projectId, runStatus, SHA_A, evidenceRoot);
  const spotCheckRun = await addVerification(client, agentRunId, projectId, 'passed', SHA_A, evidenceRoot);
  await client.query("UPDATE change_requests SET status = 'awaiting-approval' WHERE id = $1", [changeRequestId]);
  return { changeRequestId, projectId, mainRunId: mainRun.id, mainArtifactId: mainRun.artifactId, claimId: mainRun.claimId, spotCheckRunId: spotCheckRun.id, evidenceRoot, scenario };
}

async function attemptInvalidShip(scenario) {
  const client = await pool.connect();
  const fixture = await createShippingFixture(client, scenario);
  try {
    let rejection;
    try {
      const evidenceValidation = {
        requirements_evidenced: scenario !== 'unevidenced requirement',
        claims_traced: true,
        claim_traces: scenario === 'untraced claim' ? [] : [{ claim_id: fixture.claimId, evidence_artifact_ids: [fixture.mainArtifactId] }],
      };
      await client.query(
        `INSERT INTO approver_decisions
         (change_request_id, verification_run_id, decision, evidence_validation, spot_check_run_id, deeper_checks)
         VALUES ($1, $2, 'approved', $3::jsonb, $4, '{}'::jsonb)`,
        [fixture.changeRequestId, fixture.mainRunId, JSON.stringify(evidenceValidation), scenario === 'missing spot-check' ? null : fixture.spotCheckRunId],
      );
      await client.query("UPDATE change_requests SET status = 'approved' WHERE id = $1", [fixture.changeRequestId]);
      await client.query("UPDATE change_requests SET status = 'shipping' WHERE id = $1", [fixture.changeRequestId]);
      await client.query(
        `INSERT INTO ship_records (change_request_id, verification_run_id, approver_decision_id, merged_sha)
         SELECT $1, $2, ad.id, $3 FROM approver_decisions ad
         WHERE ad.change_request_id = $1 ORDER BY ad.decided_at DESC LIMIT 1`,
        [fixture.changeRequestId, fixture.mainRunId, scenario === 'wrong SHA' ? SHA_B : SHA_A],
      );
    } catch (error) {
      rejection = error;
    }
    assert.ok(rejection, `The database must reject the ${scenario} ship attempt.`);
    assert.equal(String(rejection.code).startsWith('23'), true, `Expected a PostgreSQL constraint rejection for ${scenario}.`);
    const reasonByScenario = {
      'wrong SHA': 'final verification SHA does not match the shipped SHA',
      'failing verification': 'approver gate refuses a failed verification',
      'missing spot-check': 'approved decision requires a separate spot-check',
      'unevidenced requirement': 'approved decision refuses an unevidenced requirement',
      'untraced claim': 'approved decision refuses an untraced claim',
    };
    console.log(`REJECTED ${scenario}: ${reasonByScenario[scenario]} (PostgreSQL constraint ${rejection.code}).`);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await rm(fixture.evidenceRoot, { recursive: true, force: true });
  }
}

test('PostgreSQL permits shipping only when both passing evidence gates match the final code version', async () => {
  const client = await pool.connect();
  const fixture = await createShippingFixture(client, 'valid');
  try {
    const decision = await client.query(
      `INSERT INTO approver_decisions
       (change_request_id, verification_run_id, decision, evidence_validation, spot_check_run_id)
       VALUES ($1, $2, 'approved', $4::jsonb, $3)
       RETURNING id`,
      [fixture.changeRequestId, fixture.mainRunId, fixture.spotCheckRunId, JSON.stringify({ requirements_evidenced: true, claims_traced: true, claim_traces: [{ claim_id: fixture.claimId, evidence_artifact_ids: [fixture.mainArtifactId] }] })],
    );
    await client.query("UPDATE change_requests SET status = 'approved' WHERE id = $1", [fixture.changeRequestId]);
    await client.query("UPDATE change_requests SET status = 'shipping' WHERE id = $1", [fixture.changeRequestId]);
    const ship = await client.query(
      `INSERT INTO ship_records (change_request_id, verification_run_id, approver_decision_id, merged_sha)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [fixture.changeRequestId, fixture.mainRunId, decision.rows[0].id, SHA_A],
    );
    await client.query("UPDATE change_requests SET status = 'shipped', outcome_summary = 'The verified change was shipped.' WHERE id = $1", [fixture.changeRequestId]);
    assert.ok(ship.rows[0].id);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await rm(fixture.evidenceRoot, { recursive: true, force: true });
  }
});

test('PostgreSQL refuses each illegal ship path at the earliest applicable database gate', async (context) => {
  for (const scenario of ['wrong SHA', 'failing verification', 'missing spot-check', 'unevidenced requirement', 'untraced claim']) {
    await context.test(scenario, () => attemptInvalidShip(scenario));
  }
});

test('PostgreSQL refuses to commit a failed post-shipping check without an automatic reversal', async () => {
  const client = await pool.connect();
  const fixture = await createShippingFixture(client, 'valid');
  try {
    const decision = await client.query(
      `INSERT INTO approver_decisions
       (change_request_id, verification_run_id, decision, evidence_validation, spot_check_run_id)
       VALUES ($1, $2, 'approved', $4::jsonb, $3)
       RETURNING id`,
      [fixture.changeRequestId, fixture.mainRunId, fixture.spotCheckRunId, JSON.stringify({ requirements_evidenced: true, claims_traced: true, claim_traces: [{ claim_id: fixture.claimId, evidence_artifact_ids: [fixture.mainArtifactId] }] })],
    );
    await client.query("UPDATE change_requests SET status = 'approved' WHERE id = $1", [fixture.changeRequestId]);
    await client.query("UPDATE change_requests SET status = 'shipping' WHERE id = $1", [fixture.changeRequestId]);
    const ship = await client.query(
      `INSERT INTO ship_records (change_request_id, verification_run_id, approver_decision_id, merged_sha)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [fixture.changeRequestId, fixture.mainRunId, decision.rows[0].id, SHA_A],
    );
    await client.query("UPDATE change_requests SET status = 'shipped', outcome_summary = 'The verified change was shipped.' WHERE id = $1", [fixture.changeRequestId]);
    const failedRun = await addVerification(client, fixture.agentRunId, fixture.projectId, 'failed', SHA_A, fixture.evidenceRoot);
    await client.query(
      `INSERT INTO post_checks (ship_record_id, verification_run_id, status, outcome)
       VALUES ($1, $2, 'failed', 'A saved check failed.')`,
      [ship.rows[0].id, failedRun.id],
    );
    await client.query('UPDATE ship_records SET post_check_run_id = $2 WHERE id = $1', [ship.rows[0].id, failedRun.id]);
    let rejection;
    try {
      await client.query('COMMIT');
    } catch (error) {
      rejection = error;
    }
    assert.ok(rejection, 'The database must refuse a failed post-shipping check without its automatic reversal.');
    assert.equal(rejection.code, '23514');
    console.log('REJECTED failed post-shipping check without automatic reversal (PostgreSQL constraint 23514).');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await rm(fixture.evidenceRoot, { recursive: true, force: true });
  }
});
