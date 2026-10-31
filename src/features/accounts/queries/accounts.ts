import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';
import { pool } from '../../../db/client.ts';
import { AuthorizationError, requireUserId } from '../../../db/authorization.ts';
import { createOpaqueToken, encryptStoredValue, decryptStoredValue, hashOpaqueToken } from '../../../lib/crypto.ts';

const SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 14;
const RESET_LIFETIME_MS = 1000 * 60 * 30;

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Enter a valid email address.');
  }
  return normalized;
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 1024) {
    throw new Error('Choose a password between 12 and 1,024 characters.');
  }
}

async function passwordHash(password: string): Promise<string> {
  validatePassword(password);
  return hash(password, { algorithm: 2 as Algorithm, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function createAccount(email: string, password: string): Promise<{ id: string }> {
  const normalizedEmail = normalizeEmail(email);
  const encodedPassword = await passwordHash(password);
  try {
    const result = await pool.query<{ id: string }>(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [normalizedEmail, encodedPassword],
    );
    return result.rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('An account already uses this email address.', { cause: error });
    throw error;
  }
}

export async function signIn(email: string, password: string): Promise<{ sessionToken: string; expiresAt: Date }> {
  const normalizedEmail = normalizeEmail(email);
  const account = await pool.query<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [normalizedEmail],
  );
  const found = account.rows[0];
  if (!found || !(await verify(found.password_hash, password))) {
    throw new AuthorizationError('The email or password was not recognized. Try again.');
  }
  const sessionToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [found.id, hashOpaqueToken(sessionToken), expiresAt],
  );
  return { sessionToken, expiresAt };
}

export async function getSignedInAccount(sessionToken: string): Promise<{ id: string; email: string }> {
  const userId = await requireUserId(pool, sessionToken);
  const result = await pool.query<{ id: string; email: string }>(
    'SELECT id, email FROM users WHERE id = $1',
    [userId],
  );
  if (!result.rows[0]) throw new AuthorizationError();
  return result.rows[0];
}

export async function revokeSession(sessionToken: string): Promise<void> {
  const userId = await requireUserId(pool, sessionToken);
  await pool.query(
    'UPDATE sessions SET revoked_at = now(), updated_at = now() WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL',
    [userId, hashOpaqueToken(sessionToken)],
  );
}

export async function createPasswordResetToken(email: string): Promise<string | null> {
  const normalizedEmail = normalizeEmail(email);
  const account = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (!account.rows[0]) return null;
  const token = createOpaqueToken();
  await pool.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [account.rows[0].id, hashOpaqueToken(token), new Date(Date.now() + RESET_LIFETIME_MS)],
  );
  return token;
}

export async function consumePasswordResetToken(token: string, newPassword: string): Promise<void> {
  const encodedPassword = await passwordHash(newPassword);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reset = await client.query<{ user_id: string }>(
      `UPDATE password_reset_tokens
       SET used_at = now(), updated_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [hashOpaqueToken(token)],
    );
    if (!reset.rows[0]) throw new AuthorizationError('That password-reset link has expired or was already used. Request a new one.');
    await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [encodedPassword, reset.rows[0].user_id]);
    await client.query('UPDATE sessions SET revoked_at = now(), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [reset.rows[0].user_id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function storeApiCredential(sessionToken: string, provider: string, secret: string): Promise<void> {
  const userId = await requireUserId(pool, sessionToken);
  const normalizedProvider = provider.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(normalizedProvider)) throw new Error('Choose a valid service name.');
  const encrypted = encryptStoredValue(secret);
  await pool.query(
    `INSERT INTO api_credentials (user_id, provider, ciphertext, nonce, authentication_tag)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, provider) DO UPDATE
     SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce,
         authentication_tag = EXCLUDED.authentication_tag, updated_at = now()`,
    [userId, normalizedProvider, encrypted.ciphertext, encrypted.nonce, encrypted.authenticationTag],
  );
}

export async function getApiCredential(sessionToken: string, provider: string): Promise<string | null> {
  const userId = await requireUserId(pool, sessionToken);
  const result = await pool.query<{ ciphertext: string; nonce: string; authentication_tag: string }>(
    'SELECT ciphertext, nonce, authentication_tag FROM api_credentials WHERE user_id = $1 AND provider = $2',
    [userId, provider.trim().toLowerCase()],
  );
  const stored = result.rows[0];
  return stored ? decryptStoredValue({ ciphertext: stored.ciphertext, nonce: stored.nonce, authenticationTag: stored.authentication_tag }) : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
