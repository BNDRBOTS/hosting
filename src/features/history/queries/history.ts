import { pool } from '../../../db/client.ts';
import { requireOwnedChangeRequest, requireUserId } from '../../../db/authorization.ts';

export async function listChangeHistory(sessionToken: string): Promise<Array<{
  id: string;
  project_name: string;
  request_text: string;
  status: string;
  outcome_summary: string | null;
  created_at: Date;
  merged_at: Date | null;
  post_check_status: string | null;
}>> {
  const userId = await requireUserId(pool, sessionToken);
  const result = await pool.query(
    `SELECT cr.id, p.name AS project_name, cr.request_text, cr.status, cr.outcome_summary,
            cr.created_at, sr.merged_at, pc.status AS post_check_status
     FROM change_requests cr
     JOIN projects p ON p.id = cr.project_id
     JOIN github_connections g ON g.id = p.github_connection_id
     LEFT JOIN ship_records sr ON sr.change_request_id = cr.id
     LEFT JOIN post_checks pc ON pc.ship_record_id = sr.id
     WHERE g.user_id = $1
     ORDER BY cr.created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function getChangeHistoryEntry(sessionToken: string, changeRequestId: string): Promise<{
  request_text: string;
  status: string;
  outcome_summary: string | null;
  explanation: string | null;
  risk_tier: string | null;
  shipped_at: Date | null;
  post_check_status: string | null;
  undo_at: Date | null;
} | null> {
  await requireOwnedChangeRequest(pool, sessionToken, changeRequestId);
  const result = await pool.query(
    `SELECT cr.request_text, cr.status, cr.outcome_summary, o.explanation,
            ra.tier AS risk_tier, sr.merged_at AS shipped_at, pc.status AS post_check_status,
            u.reverted_at AS undo_at
     FROM change_requests cr
     LEFT JOIN change_request_outcomes o ON o.change_request_id = cr.id
     LEFT JOIN risk_assessments ra ON ra.change_request_id = cr.id
     LEFT JOIN ship_records sr ON sr.change_request_id = cr.id
     LEFT JOIN post_checks pc ON pc.ship_record_id = sr.id
     LEFT JOIN undos u ON u.ship_record_id = sr.id
     WHERE cr.id = $1`,
    [changeRequestId],
  );
  return result.rows[0] ?? null;
}
