import { pool } from '../../../db/client.ts';
import { requireAutomationAccess, requireOwnedProject, requireOwnedChangeRequest } from '../../../db/authorization.ts';
import { requirePlainEnglishPhrase } from '../../../lib/plain-language.ts';

export async function createChangeRequest(
  sessionToken: string,
  projectId: string,
  requestText: string,
): Promise<{ id: string }> {
  await requireOwnedProject(pool, sessionToken, projectId);
  const request = requestText.trim();
  if (!request || request.length > 20_000) throw new Error('Describe the change you would like made.');
  const created = await pool.query<{ id: string }>(
    'INSERT INTO change_requests (project_id, request_text) VALUES ($1, $2) RETURNING id',
    [projectId, request],
  );
  return created.rows[0];
}

export async function decomposeChangeRequest(
  intakeKey: string,
  changeRequestId: string,
  requirementTexts: string[],
): Promise<Array<{ id: string; text: string }>> {
  await requireAutomationAccess(intakeKey, 'intake');
  const requirements = requirementTexts.map((text) => text.trim()).filter(Boolean);
  if (requirements.length === 0 || requirements.length > 100) throw new Error('At least one clear requirement is needed.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await client.query<{ status: string }>(
      'SELECT status FROM change_requests WHERE id = $1 FOR UPDATE', [changeRequestId],
    );
    if (request.rows[0]?.status !== 'queued') throw new Error('Only a newly received request can be broken into requirements.');
    const existing = await client.query<{ present: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM requirements WHERE change_request_id = $1) AS present', [changeRequestId],
    );
    if (existing.rows[0]?.present) throw new Error('Requirements have already been prepared for this request.');
    for (const text of requirements) {
      if (text.length > 2_000) throw new Error('Each requirement must be a short, testable statement.');
      await client.query('INSERT INTO requirements (change_request_id, text) VALUES ($1, $2)', [changeRequestId, text]);
    }
    const saved = await client.query<{ id: string; text: string }>(
      'SELECT id, text FROM requirements WHERE change_request_id = $1 ORDER BY created_at, id', [changeRequestId],
    );
    await client.query('COMMIT');
    return saved.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getChangeRequest(sessionToken: string, changeRequestId: string): Promise<{
  id: string;
  request_text: string;
  status: string;
  outcome_summary: string | null;
  requirements: Array<{ id: string; text: string; status: string }>;
}> {
  await requireOwnedChangeRequest(pool, sessionToken, changeRequestId);
  const [request, requirements] = await Promise.all([
    pool.query<{ id: string; request_text: string; status: string; outcome_summary: string | null }>(
      'SELECT id, request_text, status, outcome_summary FROM change_requests WHERE id = $1',
      [changeRequestId],
    ),
    pool.query<{ id: string; text: string; status: string }>(
      'SELECT id, text, status FROM requirements WHERE change_request_id = $1 ORDER BY created_at, id',
      [changeRequestId],
    ),
  ]);
  return { ...request.rows[0], requirements: requirements.rows };
}

export async function advanceChangeRequest(
  automationKey: string,
  changeRequestId: string,
  status: 'implementing' | 'verifying' | 'fixing' | 'awaiting-approval' | 'approved' | 'shipping' | 'shipped',
  outcomeSummary?: string,
): Promise<void> {
  await requireAutomationAccess(automationKey, 'orchestrator');
  const summary = outcomeSummary ? requirePlainEnglishPhrase(outcomeSummary, 'The outcome summary') : null;
  const result = await pool.query(
    `UPDATE change_requests SET status = $2, outcome_summary = COALESCE($3, outcome_summary), updated_at = now()
     WHERE id = $1`,
    [changeRequestId, status, summary],
  );
  if (!result.rowCount) throw new Error('The requested change could not be found.');
}

export async function rejectChangeRequest(
  automationKey: string,
  changeRequestId: string,
  plainEnglishExplanation: string,
): Promise<void> {
  await requireAutomationAccess(automationKey, 'orchestrator');
  const explanation = requirePlainEnglishPhrase(plainEnglishExplanation, 'The explanation');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO change_request_outcomes (change_request_id, outcome, explanation)
       VALUES ($1, 'rejected', $2)`,
      [changeRequestId, explanation],
    );
    await client.query(
      `UPDATE change_requests SET status = 'rejected', outcome_summary = $2, updated_at = now() WHERE id = $1`,
      [changeRequestId, explanation],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function markRequirementEvidenced(
  automationKey: string,
  changeRequestId: string,
  requirementId: string,
): Promise<void> {
  await requireAutomationAccess(automationKey, 'verifier');
  const result = await pool.query(
    `UPDATE requirements SET status = 'evidenced', updated_at = now()
     WHERE id = $1 AND change_request_id = $2`,
    [requirementId, changeRequestId],
  );
  if (!result.rowCount) throw new Error('The requested requirement could not be found.');
}
