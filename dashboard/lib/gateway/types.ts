import type {
  CloudSettingsView,
  LegacyMappingOptions,
  ManualCloudSetupView,
  OAuthProjectView,
  PairingMemberView,
  PairingPayloadV2,
  SessionQuery,
  StepQuery,
} from '../../../shared/ipc';
import type { Session, Step } from '../types';

export type GatewayKind = 'electron' | 'web' | 'unavailable';

export type GatewayErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_PAIRING'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'REMOTE_ERROR';

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface GatewayCapabilities {
  readonly localData: boolean;
  readonly cloudSettings: boolean;
  readonly oauth: boolean;
  readonly oauthProjectSelection: boolean;
  readonly manualCloudSetup: boolean;
  readonly pairing: boolean;
  readonly legacyMapping: boolean;
}

export type OAuthProject = OAuthProjectView;

/** Renderer-friendly projection of the shared OAuth response. */
export interface OAuthStart {
  readonly authorizationUrl: string;
  readonly state: string;
}

export type PairingEnvelopeV2 = PairingPayloadV2;
export type PairingMember = PairingMemberView;

export interface DashboardGateway {
  readonly kind: GatewayKind;
  readonly label: string;
  readonly capabilities: GatewayCapabilities;

  querySessions(query?: SessionQuery): Promise<Session[]>;
  querySteps(query: StepQuery): Promise<Step[]>;

  getCloudSettings(): Promise<CloudSettingsView>;
  beginOAuth(): Promise<OAuthStart>;
  listOAuthProjects(): Promise<readonly OAuthProject[]>;
  selectOAuthProject(projectRef: string): Promise<CloudSettingsView>;
  beginManualCloudSetup(projectUrl: string, publishableKey: string): Promise<ManualCloudSetupView>;
  confirmManualCloudSetup(setupId: string, projectUrl: string): Promise<CloudSettingsView>;
  createPairing(): Promise<PairingEnvelopeV2>;
  listPairingMembers(): Promise<readonly PairingMember[]>;
  approvePairingMember(memberId: string): Promise<void>;
  revokePairingMember(memberId: string): Promise<void>;
  listLegacyMappings(): Promise<LegacyMappingOptions>;
  mapLegacyPayload(payloadHash: string, verifiedSourceId: string): Promise<void>;
}

export const unavailableCapabilities: GatewayCapabilities = {
  localData: false,
  cloudSettings: false,
  oauth: false,
  oauthProjectSelection: false,
  manualCloudSetup: false,
  pairing: false,
  legacyMapping: false,
};
