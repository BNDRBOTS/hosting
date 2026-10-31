import { pool } from '../../../db/client.ts';
import { requireAutomationAccess } from '../../../db/authorization.ts';

export interface EvidenceValidation {
  requirements_evidenced: boolean;
  claims_traced: boolean;
  claim_traces: Array<{ claim_id: string; evidence_artifact_ids: string[] }>;
}

export async function getEvidenceForIndependentReview(
  automationKey: string,
  changeRequestId: string,
): Promise<{
  request: { request_text: string; status: string };
  requirements: Array<{ id: string; text: string; status: string }>;
  runs: Array<{ id: string; status: string; verified_sha: string | null; report: Record<string, unknown>; artifacts: Array<{ id: string; kind: string; storage_path: string }> }>;
}> {
  await requireAutomationAccess(automationKey, 'approver');
  const request = await pool.query<{ request_text: string; status: string }>(
    'SELECT request_text, status FROM change_requests WHERE id = $1', [changeRequestId],
  );
  if (!request.rows[0]) throw new Error('The requested change could not be found.');
  const [requirements, runs] = await Promise.all([
    pool.query<{ id: string; text: string; status: string }>(
      'SELECT id, text, status FROM requirements WHERE change_request_id = $1 ORDER BY created_at, id', [changeRequestId],
    ),
    pool.query<{ id: string; status: string; verified_sha: string | null; report: Record<string, unknown> }>(
      `SELECT vr.id, vr.status, vr.verified_sha, vr.report
       FROM verification_runs vr JOIN agent_runs ar ON ar.id = vr.agent_run_id
       WHERE ar.change_request_id = $1 ORDER BY vr.started_at`, [changeRequestId],
    ),
  ]);
  const withArtifacts = await Promise.all(runs.rows.map(async (run) => {
    const artifacts = await pool.query<{ id: string; kind: string; storage_path: string }>(
      'SELECT id, kind, storage_path FROM evidence_artifacts WHERE verification_run_id = $1 ORDER BY created_at, id', [run.id],
    );
    return { ...run, artifacts: artifacts.rows };
  }));
  return { request: request.rows[0], requirements: requirements.rows, runs: withArtifacts };
}

export async function recordApproverDecision(
  automationKey: string,
  input: {
    changeRequestId: string;
    verificationRunId: string;
    decision: 'approved' | 'rejected';
    evidenceValidation: EvidenceValidation;
    spotCheckRunId: string;
    deeperChecks?: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  await requireAutomationAccess(automationKey, 'approver');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string }>(
      `INSERT INTO approver_decisions
       (change_request_id, verification_run_id, decision, evidence_validation, spot_check_run_id, deeper_checks)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb) RETURNING id`,
      [input.changeRequestId, input.verificationRunId, input.decision, JSON.stringify(input.evidenceValidation), input.spotCheckRunId, JSON.stringify(input.deeperChecks ?? {})],
    );
    const nextStatus = input.decision === 'approved' ? 'approved' : 'fixing';
    await client.query('UPDATE change_requests SET status = $2, updated_at = now() WHERE id = $1', [input.changeRequestId, nextStatus]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
