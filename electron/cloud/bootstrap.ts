import { createHash, randomBytes } from 'node:crypto';

const BOOTSTRAP_SECRET = /^[A-Za-z0-9_-]{43}$/;

/** 256 bits of entropy, encoded without padding for transport to one RPC only. */
export function generateOwnerBootstrapSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function validateOwnerBootstrapSecret(secret: string): string {
  if (!BOOTSTRAP_SECRET.test(secret)) throw new Error('Owner bootstrap secret is malformed');
  return secret;
}

export function ownerBootstrapSecretHash(secret: string): string {
  return createHash('sha256').update(validateOwnerBootstrapSecret(secret), 'utf8').digest('hex');
}
