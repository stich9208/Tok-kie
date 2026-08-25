import type { PairingQrV2 } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{22,128}$/;
const CLAIM_TOKEN = /^[A-Za-z0-9-]{36}\.[A-Za-z0-9_-]{22,128}$/;
const MAX_TTL_MS = 5 * 60_000;

export interface PairingClaimToken {
  readonly pairingId: string;
  readonly oneTimeSecret: string;
}

export function encodePairingClaimToken(pairingId: string, oneTimeSecret: string): string {
  if (!UUID.test(pairingId) || !SECRET.test(oneTimeSecret)) throw new Error('Pairing identifier or secret is malformed');
  return `${pairingId}.${oneTimeSecret}`;
}

export function decodePairingClaimToken(token: string): PairingClaimToken {
  if (!CLAIM_TOKEN.test(token)) throw new Error('Pairing claim token is malformed');
  const separator = token.indexOf('.');
  const pairingId = token.slice(0, separator);
  const oneTimeSecret = token.slice(separator + 1);
  if (!UUID.test(pairingId) || !SECRET.test(oneTimeSecret)) throw new Error('Pairing claim token is malformed');
  return { pairingId, oneTimeSecret };
}

export function buildPairingQrV2(input: {
  readonly projectUrl: string;
  readonly pairingId: string;
  readonly oneTimeSecret: string;
  readonly expiresAt: string;
}, nowMs = Date.now()): PairingQrV2 {
  return validatePairingQrV2({
    v: 2,
    url: input.projectUrl,
    token: encodePairingClaimToken(input.pairingId, input.oneTimeSecret),
    exp: Date.parse(input.expiresAt),
  }, nowMs);
}

export function validateProjectUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Invalid Supabase project URL');
  }
  return url.origin;
}

export function validatePairingQrV2(value: unknown, nowMs = Date.now()): PairingQrV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pairing payload must be an object');
  const record = value as Record<string, unknown>;
  const expected = ['v','url','token','exp'];
  if (Object.keys(record).length !== expected.length || expected.some((key) => !(key in record))) {
    throw new Error('Pairing payload fields do not match v2');
  }
  if (record.v !== 2 || typeof record.url !== 'string' ||
      typeof record.token !== 'string' || typeof record.exp !== 'number') {
    throw new Error('Pairing payload contains invalid field types');
  }
  const expiresMs = record.exp;
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs || expiresMs > nowMs + MAX_TTL_MS) {
    throw new Error('Pairing token is expired or exceeds five minutes');
  }
  decodePairingClaimToken(record.token);
  return {
    v: 2,
    url: validateProjectUrl(record.url),
    token: record.token,
    exp: expiresMs,
  };
}
