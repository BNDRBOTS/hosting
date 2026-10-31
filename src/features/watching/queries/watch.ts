import type { PoolClient } from 'pg';
import { requireAutomationAccess } from '../../../db/authorization.ts';

export interface PostShipCheckInput {
  shipRecordId: string;
  verificationRunId: string;
  status: 'passed' | 'failed';
  outcome: string;
  revertedSha?: string;
  reCheckRunId?: string;
}

export async function recordPostShipCheck(
  client: PoolClient,
  automationKey: string,
  input: PostShipCheckInput,
): Promise<{ id: string }> {
  await requireAutomationAccess(automationKey, 'watcher');
  const outcome = input.outcome.trim();
  if (!outcome) throw new Error('A plain-English result is required.');
  if (input.status === 'failed' && (!input.revertedSha || !input.reCheckRunId)) {
    throw new Error('A failed post-shipping check must include the automatic reversal and its passing re-check.');
  }
  const postCheck = await client.query<{ id: string }>(
    `INSERT INTO post_checks (ship_record_id, verification_run_id, status, outcome)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.shipRecordId, input.verificationRunId, input.status, outcome],
  );
  await client.query(
    'UPDATE ship_records SET post_check_run_id = $2, updated_at = now() WHERE id = $1',
    [input.shipRecordId, input.verificationRunId],
  );
  if (input.status === 'failed') {
    const revertedSha = input.revertedSha!.toLowerCase();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revertedSha)) throw new Error('The restored code version is not valid.');
    await client.query(
      `INSERT INTO auto_reverts (ship_record_id, reverted_sha, re_check_run_id)
       VALUES ($1, $2, $3)`,
      [input.shipRecordId, revertedSha, input.reCheckRunId],
    );
  }
  return postCheck.rows[0];
}
