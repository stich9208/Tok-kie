import { AGENT_TYPES, SESSION_STATUSES, type AgentType, type SessionStatus } from './domain';
import { IPC_CHANNELS, type IpcChannel, type IpcRequestMap } from './ipc';

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPABASE_PROJECT_URL = /^https:\/\/[a-z0-9-]{3,64}\.supabase\.co\/?$/i;

function publicDataPlaneKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 4096 || /\s/.test(value)) return false;
  if (value.startsWith('sb_publishable_')) return true;
  if (!value.startsWith('eyJ')) return false;
  try {
    const segments = value.split('.');
    if (segments.length !== 3) return false;
    const payload = segments[1] ?? '';
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const claims = JSON.parse(atob(padded)) as { role?: unknown };
    return claims.role === 'anon';
  } catch {
    return false;
  }
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ path: key, message: 'unknown field' });
  }
}

function optionalBoundedInt(value: unknown, path: string, issues: ValidationIssue[], max: number): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    issues.push({ path, message: `must be an integer between 1 and ${max}` });
  }
}

/**
 * Main-process trust boundary. Every ipcMain.handle must call this before any
 * filesystem, database, shell, OAuth, or network action. Unknown fields fail.
 */
export function validateIpcRequest<C extends IpcChannel>(
  channel: C,
  input: unknown,
): ValidationResult<IpcRequestMap[C]> {
  if (!object(input)) return { ok: false, issues: [{ path: '$', message: 'must be an object' }] };
  const issues: ValidationIssue[] = [];

  switch (channel) {
    case IPC_CHANNELS.querySessions: {
      exactKeys(input, ['agent_types', 'statuses', 'started_after', 'started_before', 'include_archived', 'limit', 'cursor'], issues);
      if (input.agent_types !== undefined && (!strings(input.agent_types) || input.agent_types.some((v) => !(AGENT_TYPES as readonly string[]).includes(v)))) {
        issues.push({ path: 'agent_types', message: 'contains an unsupported agent type' });
      }
      if (input.statuses !== undefined && (!strings(input.statuses) || input.statuses.some((v) => !(SESSION_STATUSES as readonly string[]).includes(v)))) {
        issues.push({ path: 'statuses', message: 'contains an unsupported session status' });
      }
      for (const key of ['started_after', 'started_before', 'cursor'] as const) {
        if (input[key] !== undefined && typeof input[key] !== 'string') issues.push({ path: key, message: 'must be a string' });
      }
      if (input.include_archived !== undefined && typeof input.include_archived !== 'boolean') issues.push({ path: 'include_archived', message: 'must be boolean' });
      optionalBoundedInt(input.limit, 'limit', issues, 500);
      break;
    }
    case IPC_CHANNELS.querySteps:
      exactKeys(input, ['session_id', 'limit', 'cursor'], issues);
      if (typeof input.session_id !== 'string' || !input.session_id) issues.push({ path: 'session_id', message: 'must be a non-empty string' });
      if (input.cursor !== undefined && typeof input.cursor !== 'string') issues.push({ path: 'cursor', message: 'must be a string' });
      optionalBoundedInt(input.limit, 'limit', issues, 1000);
      break;
    case IPC_CHANNELS.selectOAuthProject:
      exactKeys(input, ['project_ref'], issues);
      if (typeof input.project_ref !== 'string' || !/^[a-z0-9-]{3,64}$/i.test(input.project_ref)) {
        issues.push({ path: 'project_ref', message: 'must be an explicit Supabase project ref' });
      }
      break;
    case IPC_CHANNELS.beginManualCloudSetup:
      exactKeys(input, ['project_url', 'publishable_key'], issues);
      if (typeof input.project_url !== 'string' || input.project_url.length > 256 ||
          !SUPABASE_PROJECT_URL.test(input.project_url)) {
        issues.push({ path: 'project_url', message: 'must be an HTTPS Supabase project URL' });
      }
      if (!publicDataPlaneKey(input.publishable_key)) {
        issues.push({ path: 'publishable_key', message: 'must be a publishable or legacy anon project key' });
      }
      break;
    case IPC_CHANNELS.confirmManualCloudSetup:
      exactKeys(input, ['setup_id', 'project_url'], issues);
      if (typeof input.setup_id !== 'string' || !UUID.test(input.setup_id)) {
        issues.push({ path: 'setup_id', message: 'must be a setup UUID' });
      }
      if (typeof input.project_url !== 'string' || input.project_url.length > 256 ||
          !SUPABASE_PROJECT_URL.test(input.project_url)) {
        issues.push({ path: 'project_url', message: 'must be an HTTPS Supabase project URL' });
      }
      break;
    case IPC_CHANNELS.createPairing:
      exactKeys(input, ['device_label'], issues);
      if (input.device_label !== undefined &&
          (typeof input.device_label !== 'string' || !input.device_label.trim() || input.device_label.trim().length > 120)) {
        issues.push({ path: 'device_label', message: 'must be a non-empty string of at most 120 characters' });
      }
      break;
    case IPC_CHANNELS.approvePairingMember:
    case IPC_CHANNELS.revokePairingMember:
      exactKeys(input, ['member_id'], issues);
      if (typeof input.member_id !== 'string' || !UUID.test(input.member_id)) {
        issues.push({ path: 'member_id', message: 'must be a UUID' });
      }
      break;
    case IPC_CHANNELS.mapLegacyPayload:
      exactKeys(input, ['payload_hash', 'verified_source_id'], issues);
      if (typeof input.payload_hash !== 'string' || !/^[a-f0-9]{64}$/.test(input.payload_hash)) {
        issues.push({ path: 'payload_hash', message: 'must be lowercase SHA-256' });
      }
      if (typeof input.verified_source_id !== 'string' || !input.verified_source_id || input.verified_source_id.length > 512) {
        issues.push({ path: 'verified_source_id', message: 'must be a bounded source ID' });
      }
      break;
    case IPC_CHANNELS.openExternal:
      exactKeys(input, ['url'], issues);
      if (typeof input.url !== 'string' || !/^https:\/\//i.test(input.url)) issues.push({ path: 'url', message: 'only https URLs are allowed' });
      break;
    case IPC_CHANNELS.updateTrayTitle:
      exactKeys(input, ['title'], issues);
      if (typeof input.title !== 'string' || input.title.length > 80) issues.push({ path: 'title', message: 'must be a string of at most 80 characters' });
      break;
    case IPC_CHANNELS.scan:
    case IPC_CHANNELS.collectorStatus:
    case IPC_CHANNELS.getCloudSettings:
    case IPC_CHANNELS.beginOAuth:
    case IPC_CHANNELS.listOAuthProjects:
    case IPC_CHANNELS.listPairingMembers:
    case IPC_CHANNELS.listLegacyMappings:
    case IPC_CHANNELS.hideWindow:
      exactKeys(input, [], issues);
      break;
    default:
      issues.push({ path: '$channel', message: 'unsupported IPC channel' });
  }

  return issues.length
    ? { ok: false, issues }
    : { ok: true, value: input as unknown as IpcRequestMap[C] };
}

export const runtimeEnumTypes: {
  readonly agent: readonly AgentType[];
  readonly sessionStatus: readonly SessionStatus[];
} = { agent: AGENT_TYPES, sessionStatus: SESSION_STATUSES };
