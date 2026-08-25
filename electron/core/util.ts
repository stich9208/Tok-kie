import { createHash, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentType, IsoTimestamp, JsonObject, TokenUsage } from '../../shared/domain';
import { makeSourceId } from '../../shared/ids';
import type { SourceDescriptor, SourceKind } from '../../shared/source';

export const MAX_PREVIEW_LENGTH = 500;
export const MAX_DETAIL_LENGTH = 32 * 1024;
export const MAX_METADATA_BYTES = 16 * 1024;

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function iso(value: unknown, fallback: IsoTimestamp): IsoTimestamp {
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (Number.isFinite(date.valueOf())) return date.toISOString();
  }
  return fallback;
}

export function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

export function usage(prompt: unknown, completion: unknown): TokenUsage {
  const normalizedPrompt = nonNegativeInteger(prompt);
  const normalizedCompletion = nonNegativeInteger(completion);
  return {
    prompt: normalizedPrompt,
    completion: normalizedCompletion,
    total: normalizedPrompt + normalizedCompletion,
  };
}

export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
    .replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
}

/** Preview policy: no home paths, obvious credentials, or multiline tool arguments. */
export function preview(value: unknown): string {
  return cleanText(value)
    .replace(/(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/g, '<home>')
    .replace(/\b(?:sk|pk|eyJ)[-_A-Za-z0-9.]{16,}\b/g, '<redacted>')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_PREVIEW_LENGTH);
}

/** Readable transcript text: redacted like a preview, but keeps paragraph structure. */
export function detailPreview(value: unknown): string {
  return cleanText(value)
    .replace(/(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/g, '<home>')
    .replace(/\b(?:sk|pk|eyJ)[-_A-Za-z0-9.]{16,}\b/g, '<redacted>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .slice(0, MAX_DETAIL_LENGTH)
    .trim();
}

export function boundedMetadata(value: JsonObject): JsonObject {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_METADATA_BYTES) {
    return { truncated: true };
  }
  return value;
}

export async function canonicalLocator(locator: string): Promise<string> {
  const absolute = path.resolve(locator);
  let resolved: string;
  try {
    resolved = await realpath(absolute);
  } catch {
    resolved = absolute;
  }
  const normalized = path.normalize(resolved).normalize('NFC');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

export async function describeSource(
  agentType: AgentType,
  kind: SourceKind,
  locator: string,
  displayName = path.basename(locator),
): Promise<SourceDescriptor> {
  const canonical = await canonicalLocator(locator);
  const identitySha256 = sha256(`${agentType}\0${kind}\0${canonical}`);
  let discoveredAt: string;
  try {
    discoveredAt = (await stat(canonical)).birthtime.toISOString();
  } catch {
    discoveredAt = new Date(0).toISOString();
  }
  return {
    source_id: makeSourceId(agentType, identitySha256),
    agent_type: agentType,
    kind,
    locator: canonical,
    display_name: displayName,
    enabled: true,
    discovered_at: discoveredAt,
  };
}

export function newScanId(): string {
  return `scan:v1:${randomUUID()}`;
}
