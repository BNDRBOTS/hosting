import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface EncryptedValue {
  ciphertext: string;
  nonce: string;
  authenticationTag: string;
}

function masterKey(): Buffer {
  const configuredKey = process.env.PROOFLOOP_MASTER_KEY;
  if (!configuredKey) throw new Error('PROOFLOOP_MASTER_KEY is required to protect stored secrets.');
  const key = Buffer.from(configuredKey, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== configuredKey) {
    throw new Error('PROOFLOOP_MASTER_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function encryptStoredValue(plaintext: string): EncryptedValue {
  if (plaintext.length === 0) throw new Error('A value must not be empty.');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authenticationTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptStoredValue(encrypted: EncryptedValue): string {
  const nonce = Buffer.from(encrypted.nonce, 'base64');
  const tag = Buffer.from(encrypted.authenticationTag, 'base64');
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Stored protected data is invalid.');
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function constantTimeSecretMatch(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}
