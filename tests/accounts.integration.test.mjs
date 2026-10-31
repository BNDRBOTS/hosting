import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { pool } from '../src/db/client.ts';
import {
  createAccount,
  createPasswordResetToken,
  consumePasswordResetToken,
  getSignedInAccount,
  getApiCredential,
  revokeSession,
  signIn,
  storeApiCredential,
} from '../src/features/accounts/queries/accounts.ts';
import { createOpaqueToken, decryptStoredValue, hashOpaqueToken } from '../src/lib/crypto.ts';

after(async () => pool.end());

test('Argon2id accounts, revocable sessions, expiring single-use reset links, and encrypted keys persist in PostgreSQL', async () => {
  const email = `account-${randomUUID()}@proofloop.test`;
  const password = 'a-long-password-for-real-tests';
  const account = await createAccount(email, password);
  const signedIn = await signIn(email, password);
  assert.equal((await getSignedInAccount(signedIn.sessionToken)).id, account.id);
  const passwordRecord = await pool.query('SELECT password_hash FROM users WHERE id = $1', [account.id]);
  assert.match(passwordRecord.rows[0].password_hash, /^\$argon2id\$/);
  assert.notEqual(passwordRecord.rows[0].password_hash, password);

  const rawApiKey = `provider-key-${randomUUID()}`;
  if (!process.env.PROOFLOOP_MASTER_KEY) process.env.PROOFLOOP_MASTER_KEY = Buffer.alloc(32, 41).toString('base64');
  await storeApiCredential(signedIn.sessionToken, 'openai', rawApiKey);
  const stored = await pool.query(
    'SELECT ciphertext, nonce, authentication_tag FROM api_credentials WHERE user_id = $1 AND provider = $2',
    [account.id, 'openai'],
  );
  assert.equal(stored.rowCount, 1);
  assert.notEqual(stored.rows[0].ciphertext, Buffer.from(rawApiKey).toString('base64'));
  assert.equal(decryptStoredValue({
    ciphertext: stored.rows[0].ciphertext,
    nonce: stored.rows[0].nonce,
    authenticationTag: stored.rows[0].authentication_tag,
  }), rawApiKey);
  assert.equal(await getApiCredential(signedIn.sessionToken, 'openai'), rawApiKey);

  const resetToken = await createPasswordResetToken(email);
  assert.ok(resetToken);
  const resetRow = await pool.query('SELECT token_hash, used_at FROM password_reset_tokens WHERE user_id = $1', [account.id]);
  assert.equal(resetRow.rows[0].token_hash, createHash('sha256').update(resetToken).digest('hex'));
  assert.notEqual(resetRow.rows[0].token_hash, resetToken);
  const expiredToken = createOpaqueToken();
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() - interval '1 hour')`,
    [account.id, hashOpaqueToken(expiredToken)],
  );
  await assert.rejects(() => consumePasswordResetToken(expiredToken, 'a-valid-expired-password'), /expired or was already used/);

  const replacementPassword = 'a-different-long-password-for-tests';
  await consumePasswordResetToken(resetToken, replacementPassword);
  await assert.rejects(() => consumePasswordResetToken(resetToken, 'another-long-password'), /expired or was already used/);
  await assert.rejects(() => getSignedInAccount(signedIn.sessionToken), /sign-in has expired/);
  await assert.rejects(() => signIn(email, password), /was not recognized/);
  const newSession = await signIn(email, replacementPassword);
  assert.equal((await getSignedInAccount(newSession.sessionToken)).id, account.id);
  await revokeSession(newSession.sessionToken);
  await assert.rejects(() => getSignedInAccount(newSession.sessionToken), /sign-in has expired/);

  assert.equal(hashOpaqueToken(resetToken), resetRow.rows[0].token_hash);
});
