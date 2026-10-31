import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../../../db/client.ts';
import { requireAutomationAccess } from '../../../db/authorization.ts';

export type EvidenceKind = 'screenshot' | 'log' | 'network' | 'database';
export interface EvidenceInput { kind: EvidenceKind; storagePath: string }
export interface VerificationClaim { id: string; statement: string }
export interface VerificationReport extends Record<string, unknown> { claims: VerificationClaim[] }

export async function recordVerificationRun(
  automationKey: string,
  input: {
    agentRunId: string;
    projectId: string;
    verifiedSha: string;
    status: 'passed' | 'failed';
    report: VerificationReport;
    artifacts: EvidenceInput[];
  },
): Promise<{ id: string }> {
  await requireAutomationAccess(automationKey, 'verifier');
  const sha = input.verifiedSha.toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new Error('The tested code version is not a valid SHA identifier.');
  if (Object.keys(input.report).length === 0 || input.artifacts.length === 0) throw new Error('A verification report and at least one evidence artifact are required.');
  if (input.status === 'passed' && (!Array.isArray(input.report.claims) || input.report.claims.some((claim) => typeof claim?.id !== 'string' || !claim.id.trim() || typeof claim.statement !== 'string' || !claim.statement.trim()) || new Set(input.report.claims.map((claim) => claim.id)).size !== input.report.claims.length)) {
    throw new Error('A passing verification must list uniquely identified, plainly worded claims.');
  }
  for (const artifact of input.artifacts) await assertNonEmptyEvidenceFile(artifact.storagePath);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = await client.query<{ id: string }>(
      `INSERT INTO verification_runs (agent_run_id, project_id, status, report)
       VALUES ($1, $2, 'running', $3::jsonb) RETURNING id`,
      [input.agentRunId, input.projectId, JSON.stringify(input.report)],
    );
    for (const artifact of input.artifacts) {
      await client.query(
        'INSERT INTO evidence_artifacts (verification_run_id, kind, storage_path) VALUES ($1, $2, $3)',
        [run.rows[0].id, artifact.kind, artifact.storagePath],
      );
    }
    await client.query(
      `UPDATE verification_runs SET status = $2, verified_sha = $3, report = $4::jsonb,
       ended_at = now(), updated_at = now() WHERE id = $1`,
      [run.rows[0].id, input.status, sha, JSON.stringify(input.report)],
    );
    await client.query('COMMIT');
    return run.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listEvidenceForRun(automationKey: string, verificationRunId: string): Promise<Array<{ id: string; kind: EvidenceKind; storage_path: string }>> {
  await requireAutomationAccess(automationKey, 'verifier');
  const result = await pool.query<{ id: string; kind: EvidenceKind; storage_path: string }>(
    `SELECT id, kind, storage_path FROM evidence_artifacts
     WHERE verification_run_id = $1 ORDER BY created_at, id`,
    [verificationRunId],
  );
  return result.rows;
}

async function assertNonEmptyEvidenceFile(storagePath: string): Promise<void> {
  const configuredRoot = process.env.PROOFLOOP_EVIDENCE_DIR;
  if (!configuredRoot) throw new Error('PROOFLOOP_EVIDENCE_DIR must point to the evidence folder.');
  const root = await realpath(configuredRoot);
  const candidate = await realpath(path.resolve(root, storagePath));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Evidence must be stored inside the evidence folder.');
  const file = await stat(candidate);
  if (!file.isFile() || file.size === 0) throw new Error('Every evidence file must exist and contain data.');
}
