import { pool } from '../../../db/client.ts';
import { requireAutomationAccess } from '../../../db/authorization.ts';
import { requirePlainEnglishPhrase } from '../../../lib/plain-language.ts';

export async function startAgentRun(
  automationKey: string,
  changeRequestId: string,
  sandboxId: string,
  attemptNumber: number,
): Promise<{ id: string }> {
  await requireAutomationAccess(automationKey, 'implementer');
  if (!sandboxId.trim() || !Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 5) {
    throw new Error('The automated attempt details are invalid.');
  }
  const result = await pool.query<{ id: string }>(
    `INSERT INTO agent_runs (change_request_id, sandbox_id, status, attempt_number)
     VALUES ($1, $2, 'running', $3) RETURNING id`,
    [changeRequestId, sandboxId.trim(), attemptNumber],
  );
  return result.rows[0];
}

export async function recordAgentEvent(automationKey: string, agentRunId: string, humanPhrase: string): Promise<{ id: string }> {
  await requireAutomationAccess(automationKey, 'implementer');
  const phrase = requirePlainEnglishPhrase(humanPhrase, 'The progress update');
  const result = await pool.query<{ id: string }>(
    `INSERT INTO agent_events (agent_run_id, human_phrase)
     SELECT id, $2 FROM agent_runs WHERE id = $1 AND status = 'running'
     RETURNING id`,
    [agentRunId, phrase],
  );
  if (!result.rows[0]) throw new Error('This work attempt is no longer active.');
  return result.rows[0];
}

export async function finishAgentRun(
  automationKey: string,
  agentRunId: string,
  status: 'passed' | 'failed' | 'cancelled',
): Promise<void> {
  await requireAutomationAccess(automationKey, 'implementer');
  const result = await pool.query(
    `UPDATE agent_runs SET status = $2, ended_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'running'`,
    [agentRunId, status],
  );
  if (!result.rowCount) throw new Error('This work attempt has already ended.');
}
