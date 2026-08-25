import type { AgentType, IsoTimestamp, Session, SessionStatus, Step } from './domain';

export const IPC_CHANNELS = {
  querySessions: 'tokkie:data:query-sessions',
  querySteps: 'tokkie:data:query-steps',
  scan: 'tokkie:collector:scan',
  collectorStatus: 'tokkie:collector:status',
  getCloudSettings: 'tokkie:cloud:get-settings',
  beginOAuth: 'tokkie:cloud:begin-oauth',
  listOAuthProjects: 'tokkie:cloud:list-oauth-projects',
  selectOAuthProject: 'tokkie:cloud:select-oauth-project',
  beginManualCloudSetup: 'tokkie:cloud:begin-manual-setup',
  confirmManualCloudSetup: 'tokkie:cloud:confirm-manual-setup',
  createPairing: 'tokkie:cloud:create-pairing',
  listPairingMembers: 'tokkie:cloud:list-pairing-members',
  approvePairingMember: 'tokkie:cloud:approve-pairing-member',
  revokePairingMember: 'tokkie:cloud:revoke-pairing-member',
  listLegacyMappings: 'tokkie:legacy:list-mappings',
  mapLegacyPayload: 'tokkie:legacy:map-payload',
  openExternal: 'tokkie:shell:open-external',
  updateTrayTitle: 'tokkie:window:update-tray-title',
  hideWindow: 'tokkie:window:hide',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface SessionQuery {
  readonly agent_types?: readonly AgentType[];
  readonly statuses?: readonly SessionStatus[];
  readonly started_after?: IsoTimestamp;
  readonly started_before?: IsoTimestamp;
  readonly include_archived?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface StepQuery {
  readonly session_id: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly next_cursor?: string;
}

export interface CollectorStatus {
  readonly state: 'idle' | 'scanning' | 'error';
  readonly last_scan_at?: IsoTimestamp;
  readonly sources_seen: number;
  readonly diagnostics: number;
}

export interface CloudSettingsView {
  readonly configured: boolean;
  readonly project_url?: string;
  readonly project_ref?: string;
  readonly owner_id?: string;
  readonly member_id?: string;
  /** Secrets and tokens are deliberately absent. */
  readonly auth_mode?: 'manual_publishable_key' | 'oauth_pkce' | 'paired_member';
}

export interface OAuthStartResponse {
  readonly authorization_url: string;
  readonly state: string;
  readonly expires_at: IsoTimestamp;
}

export interface OAuthProjectView {
  readonly id: string;
  readonly ref: string;
  readonly name: string;
}

export interface ManualCloudSetupView {
  readonly setup_id: string;
  readonly project_ref: string;
  readonly expires_at: IsoTimestamp;
  /** Public schema plus a digest-only bootstrap install call. */
  readonly setup_sql: string;
}

export interface PairingPayloadV2 {
  readonly v: 2;
  /** Routing only. The matching web deployment supplies its own public key. */
  readonly url: string;
  readonly token: string;
  /** Epoch milliseconds, no more than five minutes after issuance. */
  readonly exp: number;
}

export interface PairingMemberView {
  readonly id: string;
  readonly role: 'viewer' | 'device';
  readonly display_name: string;
  readonly created_at: IsoTimestamp;
  readonly approved_at?: IsoTimestamp;
}

export interface LegacyPayloadView {
  readonly payload_hash: string;
  readonly entity_type: 'session' | 'step';
  readonly legacy_id: string;
  readonly canonical_id: string;
  readonly mapped_source_id?: string;
}

export interface VerifiedSourceView {
  readonly source_id: string;
  readonly agent_type: AgentType;
  readonly display_name: string;
}

export interface LegacyMappingOptions {
  readonly payloads: readonly LegacyPayloadView[];
  readonly sources: readonly VerifiedSourceView[];
}

export interface ScanResponse {
  readonly scan_id: string;
  readonly accepted_sources: number;
  readonly rejected_sources: number;
}

export interface IpcRequestMap {
  [IPC_CHANNELS.querySessions]: SessionQuery;
  [IPC_CHANNELS.querySteps]: StepQuery;
  [IPC_CHANNELS.scan]: Record<string, never>;
  [IPC_CHANNELS.collectorStatus]: Record<string, never>;
  [IPC_CHANNELS.getCloudSettings]: Record<string, never>;
  [IPC_CHANNELS.beginOAuth]: Record<string, never>;
  [IPC_CHANNELS.listOAuthProjects]: Record<string, never>;
  [IPC_CHANNELS.selectOAuthProject]: { readonly project_ref: string };
  [IPC_CHANNELS.beginManualCloudSetup]: {
    readonly project_url: string;
    readonly publishable_key: string;
  };
  [IPC_CHANNELS.confirmManualCloudSetup]: {
    readonly setup_id: string;
    readonly project_url: string;
  };
  [IPC_CHANNELS.createPairing]: { readonly device_label?: string };
  [IPC_CHANNELS.listPairingMembers]: Record<string, never>;
  [IPC_CHANNELS.approvePairingMember]: { readonly member_id: string };
  [IPC_CHANNELS.revokePairingMember]: { readonly member_id: string };
  [IPC_CHANNELS.listLegacyMappings]: Record<string, never>;
  [IPC_CHANNELS.mapLegacyPayload]: {
    readonly payload_hash: string;
    readonly verified_source_id: string;
  };
  [IPC_CHANNELS.openExternal]: { readonly url: string };
  [IPC_CHANNELS.updateTrayTitle]: { readonly title: string };
  [IPC_CHANNELS.hideWindow]: Record<string, never>;
}

export interface IpcResponseMap {
  [IPC_CHANNELS.querySessions]: Page<Session>;
  [IPC_CHANNELS.querySteps]: Page<Step>;
  [IPC_CHANNELS.scan]: ScanResponse;
  [IPC_CHANNELS.collectorStatus]: CollectorStatus;
  [IPC_CHANNELS.getCloudSettings]: CloudSettingsView;
  [IPC_CHANNELS.beginOAuth]: OAuthStartResponse;
  [IPC_CHANNELS.listOAuthProjects]: readonly OAuthProjectView[];
  [IPC_CHANNELS.selectOAuthProject]: CloudSettingsView;
  [IPC_CHANNELS.beginManualCloudSetup]: ManualCloudSetupView;
  [IPC_CHANNELS.confirmManualCloudSetup]: CloudSettingsView;
  [IPC_CHANNELS.createPairing]: PairingPayloadV2;
  [IPC_CHANNELS.listPairingMembers]: readonly PairingMemberView[];
  [IPC_CHANNELS.approvePairingMember]: { readonly approved: true };
  [IPC_CHANNELS.revokePairingMember]: { readonly revoked: true };
  [IPC_CHANNELS.listLegacyMappings]: LegacyMappingOptions;
  [IPC_CHANNELS.mapLegacyPayload]: { readonly mapped: true };
  [IPC_CHANNELS.openExternal]: { readonly opened: true };
  [IPC_CHANNELS.updateTrayTitle]: { readonly updated: true };
  [IPC_CHANNELS.hideWindow]: { readonly hidden: true };
}

export interface IpcFailure {
  readonly ok: false;
  readonly error: {
    readonly code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'INTERNAL';
    readonly message: string;
    readonly retryable: boolean;
  };
}

export type IpcReply<T> = { readonly ok: true; readonly value: T } | IpcFailure;

export interface TokkieApi {
  invoke<C extends IpcChannel>(channel: C, request: IpcRequestMap[C]): Promise<IpcReply<IpcResponseMap[C]>>;
}
