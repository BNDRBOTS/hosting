import { pool } from '../../../db/client.ts';
import type { PoolClient } from 'pg';
import { AuthorizationError, requireAutomationAccess, requireUserId } from '../../../db/authorization.ts';

export async function recordSystemUndo(
  client: PoolClient,
  watcherKey: string,
  shipRecordId: string,
  revertedSha: string,
): Promise<{ id: string }> {
  await requireAutomationAccess(watcherKey, 'watcher');
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revertedSha)) throw new Error('The restored code version is not valid.');
  const result = await client.query<{ id: string }>(
    `INSERT INTO undos (ship_record_id, reverted_sha, initiated_by)
     VALUES ($1, $2, 'system') RETURNING id`,
    [shipRecordId, revertedSha.toLowerCase()],
  );
  return result.rows[0];
}

export async function recordUserUndo(sessionToken: string, shipRecordId: string, revertedSha: string): Promise<{ id: string }> {
  const userId = await requireUserId(pool, sessionToken);
  const shippedChange = await pool.query(
    `SELECT sr.id FROM ship_records sr
     JOIN change_requests cr ON cr.id = sr.change_request_id
     JOIN projects p ON p.id = cr.project_id
     JOIN github_connections g ON g.id = p.github_connection_id
     WHERE sr.id = $1 AND g.user_id = $2`,
    [shipRecordId, userId],
  );
  if (!shippedChange.rowCount) throw new AuthorizationError();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revertedSha)) throw new Error('The restored code version is not valid.');
  const result = await pool.query<{ id: string }>(
    `INSERT INTO undos (ship_record_id, reverted_sha, initiated_by)
     VALUES ($1, $2, 'user') RETURNING id`,
    [shipRecordId, revertedSha.toLowerCase()],
  );
  return result.rows[0];
}
