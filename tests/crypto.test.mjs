import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptStoredValue, encryptStoredValue } from '../src/lib/crypto.ts';

const originalKey = process.env.PROOFLOOP_MASTER_KEY;
test('AES-256-GCM stores only ciphertext and restores a secret inside the crypto module', () => {
  process.env.PROOFLOOP_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
  try {
    const secret = 'private-provider-key';
    const encrypted = encryptStoredValue(secret);
    assert.notEqual(encrypted.ciphertext, Buffer.from(secret).toString('base64'));
    assert.equal(decryptStoredValue(encrypted), secret);
    assert.notEqual(encryptStoredValue(secret).nonce, encrypted.nonce);
  } finally {
    if (originalKey === undefined) delete process.env.PROOFLOOP_MASTER_KEY;
    else process.env.PROOFLOOP_MASTER_KEY = originalKey;
  }
});

test('authenticated encryption rejects modified data', () => {
  process.env.PROOFLOOP_MASTER_KEY = Buffer.alloc(32, 8).toString('base64');
  try {
    const encrypted = encryptStoredValue('private-provider-key');
    assert.throws(() => decryptStoredValue({ ...encrypted, ciphertext: Buffer.from('forged').toString('base64') }));
  } finally {
    if (originalKey === undefined) delete process.env.PROOFLOOP_MASTER_KEY;
    else process.env.PROOFLOOP_MASTER_KEY = originalKey;
  }
});
