import type { AgentType } from './domain';

const SHA256_RE = /^[a-f0-9]{64}$/;

function component(value: string): string {
  const normalized = value.normalize('NFC').trim();
  if (!normalized) throw new Error('ID component must not be empty');
  return encodeURIComponent(normalized).replace(/%/g, '~');
}

/** The fingerprint is SHA-256(agent + NUL + kind + NUL + canonical local locator). */
export function makeSourceId(agent: AgentType, identitySha256: string): string {
  if (!SHA256_RE.test(identitySha256)) throw new Error('identitySha256 must be lowercase SHA-256');
  return `src:v1:${agent}:${identitySha256}`;
}

export function makeSessionId(sourceId: string, nativeSessionId: string): string {
  if (!sourceId.startsWith('src:v1:')) throw new Error('sourceId is not a v1 source ID');
  return `ses:v1:${component(sourceId)}:${component(nativeSessionId)}`;
}

export function makeStepId(sessionId: string, nativeStepId: string): string {
  if (!sessionId.startsWith('ses:v1:')) throw new Error('sessionId is not a v1 session ID');
  return `stp:v1:${component(sessionId)}:${component(nativeStepId)}`;
}
