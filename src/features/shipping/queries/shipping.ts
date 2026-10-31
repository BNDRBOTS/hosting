import { pool } from '../../../db/client.ts';
import { requireAutomationAccess } from '../../../db/authorization.ts';

export async function recordAutomaticShip(
  automationKey: string,
  input: { changeRequestId: string; verificationRunId: string; approverDecisionId: string; mergedSha: string },
): Promise<{ id: string }> {
  await requireAutomationAccess(automationKey, 'shipper');
  const sha = input.mergedSha.toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new Error('The shipped code version is not a valid SHA identifier.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await client.query<{ status: string }>(
      'SELECT status FROM change_requests WHERE id = $1 FOR UPDATE', [input.changeRequestId],
    );
    if (state.rows[0]?.status !== 'approved') throw new Error('This change has not passed its approval gate.');
    await client.query('UPDATE change_requests SET status = \'shipping\', updated_at = now() WHERE id = $1', [input.changeRequestId]);
    const record = await client.query<{ id: string }>(
      `INSERT INTO ship_records (change_request_id, verification_run_id, approver_decision_id, merged_sha)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.changeRequestId, input.verificationRunId, input.approverDecisionId, sha],
    );
    await client.query(
      `UPDATE change_requests SET status = 'shipped', outcome_summary = 'The change passed its checks and is now live.', updated_at = now()
       WHERE id = $1`,
      [input.changeRequestId],
    );
    await client.query('COMMIT');
    return record.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
