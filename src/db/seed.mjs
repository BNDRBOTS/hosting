import { Algorithm, hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { encryptStoredValue } from '../lib/crypto.ts';

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Fixture data can be added only when NODE_ENV=test.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://proofloop:proofloop@localhost:5432/proofloop',
});
const fixtureUserId = '00000000-0000-4000-8000-000000000001';
const fixtureConnectionId = '00000000-0000-4000-8000-000000000002';
const fixtureProjectId = '00000000-0000-4000-8000-000000000003';
const fixtureChangeId = '00000000-0000-4000-8000-000000000004';
const fixtureRequirementId = '00000000-0000-4000-8000-000000000005';
const fixturePasswordHash = await hash('proofloop-test-only-account-password', {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});
const encryptedFixtureCredential = encryptStoredValue('proofloop-test-only-github-credential');

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [fixtureUserId, 'fixture-owner@proofloop.test', fixturePasswordHash],
    );
    await client.query(
      `INSERT INTO github_connections (id, user_id, github_account_id, ciphertext, nonce, authentication_tag)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [fixtureConnectionId, fixtureUserId, 'proofloop-fixture-account', encryptedFixtureCredential.ciphertext, encryptedFixtureCredential.nonce, encryptedFixtureCredential.authenticationTag],
    );
    await client.query(
      `INSERT INTO projects (id, github_connection_id, github_repo_id, default_branch, name)
       VALUES ($1, $2, $3, 'main', 'ProofLoop local test project') ON CONFLICT (id) DO NOTHING`,
      [fixtureProjectId, fixtureConnectionId, 'proofloop-fixture-repository'],
    );
    await client.query(
      `INSERT INTO verification_contracts (project_id, status, definition)
       VALUES ($1, 'missing', '{}'::jsonb) ON CONFLICT (project_id) DO NOTHING`,
      [fixtureProjectId],
    );
    await client.query(
      `INSERT INTO change_requests (id, project_id, request_text, status)
       VALUES ($1, $2, $3, 'queued') ON CONFLICT (id) DO NOTHING`,
      [fixtureChangeId, fixtureProjectId, 'Make the welcome heading readable on small screens.'],
    );
    await client.query(
      `INSERT INTO requirements (id, change_request_id, text)
       VALUES ($1, $2, 'The welcome heading fits within a narrow screen.')
       ON CONFLICT (id) DO NOTHING`,
      [fixtureRequirementId, fixtureChangeId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
