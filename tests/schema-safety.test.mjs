import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('database relationships do not silently cascade-delete user data', async () => {
  const migration = await readFile(new URL('../src/db/migrations/0000_proofloop_data_layer.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(migration, /ON DELETE CASCADE/i);
  assert.equal((migration.match(/ON DELETE restrict/gi) ?? []).length, 27);
});

test('provider credentials have encrypted fields and no plaintext secret column', async () => {
  const schema = await readFile(new URL('../src/db/schema.ts', import.meta.url), 'utf8');
  const credentialTable = schema.split('export const apiCredentials = ')[1].split('\n});')[0];
  assert.match(credentialTable, /ciphertext: text\('ciphertext'\)/);
  assert.match(credentialTable, /nonce: varchar\('nonce'/);
  assert.match(credentialTable, /authenticationTag: varchar\('authentication_tag'/);
  assert.doesNotMatch(credentialTable, /token:|secret: text/);
  assert.match(schema, /users_password_hash_argon2id_check/);
});

test('history is represented by read queries rather than a duplicated table', async () => {
  const schema = await readFile(new URL('../src/db/schema.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(schema, /pgTable\(['"]history['"]/);
});
