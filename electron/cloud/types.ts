export interface ManagementProject {
  readonly id: string;
  readonly ref: string;
  readonly name: string;
  readonly organizationId?: string;
}

export interface BeginOAuthResult {
  readonly authorizationUrl: string;
  readonly state: string;
  readonly expiresAt: string;
}

export interface CompleteAuthorizationResult {
  /** The management token remains in main-process memory and is never returned. */
  readonly projects: readonly ManagementProject[];
}

export interface SelectedCloudProject {
  readonly projectId: string;
  readonly projectRef: string;
  readonly projectUrl: string;
  readonly publishableKey: string;
}

/** QR v2 contains routing data and one-time claim material, never a project key. */
export interface PairingQrV2 {
  readonly v: 2;
  readonly url: string;
  /** Opaque pairing_id + one-time secret; it is not an auth/session credential. */
  readonly token: string;
  /** Epoch milliseconds, at most five minutes after issuance. */
  readonly exp: number;
}

export interface CloudProvisioningApi {
  beginOAuth(): BeginOAuthResult;
  completeAuthorization(callbackUrl: string): Promise<CompleteAuthorizationResult>;
  listProjects(): Promise<readonly ManagementProject[]>;
  /** A project ID supplied by a user choice is mandatory; there is no implicit first project. */
  selectProject(projectId: string): Promise<SelectedCloudProject>;
  applySchema(projectId: string, sql: string): Promise<void>;
  /** Installs only a digest; the raw one-time secret never enters the management plane. */
  installOwnerBootstrap(projectId: string, secretSha256: string): Promise<void>;
  clearManagementSession(): void;
}
