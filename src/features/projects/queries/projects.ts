import { pool } from '../../../db/client.ts';
import { AuthorizationError, requireOwnedProject, requireUserId } from '../../../db/authorization.ts';
import { decryptStoredValue, encryptStoredValue } from '../../../lib/crypto.ts';

export async function connectGithub(
  sessionToken: string,
  githubAccountId: string,
  accessToken: string,
): Promise<{ id: string }> {
  const userId = await requireUserId(pool, sessionToken);
  if (!githubAccountId.trim() || !accessToken) throw new Error('Connect a valid GitHub account.');
  const encrypted = encryptStoredValue(accessToken);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO github_connections (user_id, github_account_id, ciphertext, nonce, authentication_tag)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, github_account_id) DO UPDATE
     SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce,
         authentication_tag = EXCLUDED.authentication_tag, updated_at = now()
     RETURNING id`,
    [userId, githubAccountId.trim(), encrypted.ciphertext, encrypted.nonce, encrypted.authenticationTag],
  );
  return result.rows[0];
}

export async function getGithubAccessToken(sessionToken: string, githubConnectionId: string): Promise<string> {
  const userId = await requireUserId(pool, sessionToken);
  const result = await pool.query<{ ciphertext: string; nonce: string; authentication_tag: string }>(
    'SELECT ciphertext, nonce, authentication_tag FROM github_connections WHERE id = $1 AND user_id = $2',
    [githubConnectionId, userId],
  );
  const stored = result.rows[0];
  if (!stored) throw new AuthorizationError();
  return decryptStoredValue({ ciphertext: stored.ciphertext, nonce: stored.nonce, authenticationTag: stored.authentication_tag });
}

export async function addProject(
  sessionToken: string,
  githubConnectionId: string,
  githubRepoId: string,
  defaultBranch: string,
  name: string,
): Promise<{ id: string }> {
  const userId = await requireUserId(pool, sessionToken);
  const connection = await pool.query(
    'SELECT id FROM github_connections WHERE id = $1 AND user_id = $2',
    [githubConnectionId, userId],
  );
  if (!connection.rowCount) throw new AuthorizationError();
  const safeName = name.trim();
  const safeBranch = defaultBranch.trim();
  if (!githubRepoId.trim() || !safeName || !safeBranch) throw new Error('Add a project name and select a GitHub project.');
  const result = await pool.query<{ id: string }>(
    `INSERT INTO projects (github_connection_id, github_repo_id, default_branch, name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [githubConnectionId, githubRepoId.trim(), safeBranch, safeName],
  );
  return result.rows[0];
}

export async function listProjects(sessionToken: string): Promise<Array<{ id: string; name: string; default_branch: string; github_repo_id: string }>> {
  const userId = await requireUserId(pool, sessionToken);
  const result = await pool.query<{ id: string; name: string; default_branch: string; github_repo_id: string }>(
    `SELECT p.id, p.name, p.default_branch, p.github_repo_id
     FROM projects p JOIN github_connections g ON g.id = p.github_connection_id
     WHERE g.user_id = $1 ORDER BY p.created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function renameProject(sessionToken: string, projectId: string, name: string): Promise<void> {
  await requireOwnedProject(pool, sessionToken, projectId);
  const safeName = name.trim();
  if (!safeName || safeName.length > 255) throw new Error('Enter a project name of 1 to 255 characters.');
  await pool.query('UPDATE projects SET name = $1, updated_at = now() WHERE id = $2', [safeName, projectId]);
}
