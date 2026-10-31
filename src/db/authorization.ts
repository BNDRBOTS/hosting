import type { Pool, PoolClient } from 'pg';
import { hashOpaqueToken, constantTimeSecretMatch } from '../lib/crypto.ts';

export type QueryExecutor = Pool | PoolClient;
export type AutomationRole = 'intake' | 'implementer' | 'verifier' | 'risk' | 'approver' | 'shipper' | 'watcher' | 'orchestrator';

const roleEnvironmentNames: Record<AutomationRole, string> = {
  intake: 'PROOFLOOP_INTAKE_KEY',
  implementer: 'PROOFLOOP_IMPLEMENTER_KEY',
  verifier: 'PROOFLOOP_VERIFIER_KEY',
  risk: 'PROOFLOOP_RISK_KEY',
  approver: 'PROOFLOOP_APPROVER_KEY',
  shipper: 'PROOFLOOP_SHIPPER_KEY',
  watcher: 'PROOFLOOP_WATCHER_KEY',
  orchestrator: 'PROOFLOOP_ORCHESTRATOR_KEY',
};

export class AuthorizationError extends Error {
  constructor(message = 'This action is not available for this account.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export async function requireUserId(executor: QueryExecutor, sessionToken: string): Promise<string> {
  if (!sessionToken) throw new AuthorizationError('Sign in to continue.');
  const tokenHash = hashOpaqueToken(sessionToken);
  const result = await executor.query<{ user_id: string }>(
    `SELECT user_id FROM sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  if (!result.rows[0]) throw new AuthorizationError('Your sign-in has expired. Sign in again.');
  return result.rows[0].user_id;
}

export async function requireOwnedProject(
  executor: QueryExecutor,
  sessionToken: string,
  projectId: string,
): Promise<string> {
  const userId = await requireUserId(executor, sessionToken);
  const result = await executor.query(
    `SELECT p.id FROM projects p
     JOIN github_connections g ON g.id = p.github_connection_id
     WHERE p.id = $1 AND g.user_id = $2`,
    [projectId, userId],
  );
  if (!result.rowCount) throw new AuthorizationError();
  return userId;
}

export async function requireOwnedChangeRequest(
  executor: QueryExecutor,
  sessionToken: string,
  changeRequestId: string,
): Promise<string> {
  const userId = await requireUserId(executor, sessionToken);
  const result = await executor.query(
    `SELECT cr.id FROM change_requests cr
     JOIN projects p ON p.id = cr.project_id
     JOIN github_connections g ON g.id = p.github_connection_id
     WHERE cr.id = $1 AND g.user_id = $2`,
    [changeRequestId, userId],
  );
  if (!result.rowCount) throw new AuthorizationError();
  return userId;
}

export async function requireAutomationAccess(suppliedKey: string, role: AutomationRole): Promise<void> {
  const configured = Object.values(roleEnvironmentNames).map((name) => process.env[name]);
  if (configured.some((key) => !key || key.length < 32) || new Set(configured).size !== configured.length) {
    throw new AuthorizationError('Automated access is not configured with separate role keys.');
  }
  const expected = process.env[roleEnvironmentNames[role]];
  if (!expected || typeof suppliedKey !== 'string' || !constantTimeSecretMatch(suppliedKey, expected)) {
    throw new AuthorizationError('This automated action is not available.');
  }
}
