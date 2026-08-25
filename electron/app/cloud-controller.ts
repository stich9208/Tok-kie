import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SafeStorageLike } from '../cloud/storage';
import {
  AtomicConfigStore,
  CredentialVault,
  PairingAdministrationService,
  SupabaseManagementClient,
  SupabaseSyncClient,
  assertPublicDataPlaneKey,
  generateOwnerBootstrapSecret,
  mapOutboxEntry,
  ownerBootstrapSecretHash,
  validateOwnerBootstrapSecret,
  validateProjectUrl,
  type ManagementProject,
  type PairingQrV2,
} from '../cloud';
import type { CollectorCoreFacade } from '../core/facade';

const SESSION_SKEW_MS = 60_000;
const MANUAL_SETUP_TTL_MS = 10 * 60_000;
const MAX_SETUP_SQL_BYTES = 1_000_000;

interface PersistedCloudConfig {
  readonly version: 1;
  readonly projectUrl: string;
  readonly projectRef: string;
  readonly publishableKey: string;
  readonly authMode: 'manual_publishable_key' | 'oauth_pkce';
  readonly ownerId?: string;
  readonly memberId?: string;
}

interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAtMs: number;
}

interface AuthResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
}

export interface CloudSettingsSnapshot {
  readonly configured: boolean;
  readonly project_url?: string;
  readonly project_ref?: string;
  readonly owner_id?: string;
  readonly member_id?: string;
  readonly auth_mode?: 'manual_publishable_key' | 'oauth_pkce';
}

export interface ManualCloudSetup {
  readonly setup_id: string;
  readonly project_ref: string;
  readonly expires_at: string;
  /** Checked-in schema plus a digest-only install call. Never contains the raw secret. */
  readonly setup_sql: string;
}

/** Explicit renderer-safe member projection. Auth user IDs and tenant IDs stay in main. */
export interface SanitizedCloudMember {
  readonly id: string;
  readonly role: 'viewer' | 'device';
  readonly display_name: string;
  readonly created_at: string;
  readonly approved_at?: string;
}

export interface CloudControllerOptions {
  readonly configPath: string;
  readonly credentialPath: string;
  readonly schemaPath: string;
  readonly safeStorage: SafeStorageLike;
  readonly collector: CollectorCoreFacade;
  readonly management?: {
    readonly clientId: string;
    readonly authorizationEndpoint: string;
    readonly tokenEndpoint: string;
    readonly managementApiOrigin: string;
    readonly allowedOrigins: readonly string[];
    readonly scopes: readonly string[];
  };
  readonly fetchImpl?: typeof fetch;
  /** Test seams; production callers use cryptographically secure/default values. */
  readonly randomBytesImpl?: (size: number) => Buffer;
  readonly randomUuidImpl?: () => string;
  readonly now?: () => number;
  readonly manualSetupTtlMs?: number;
}

interface PendingManualSetup {
  readonly id: string;
  readonly projectUrl: string;
  readonly projectRef: string;
  readonly publishableKey: string;
  readonly secret: Buffer;
  readonly expiresAtMs: number;
}

function checkedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Cloud response omitted ${field}`);
  return value;
}

function projectRef(projectUrl: string): string {
  return new URL(projectUrl).hostname.slice(0, -'.supabase.co'.length);
}

function parseConfig(value: PersistedCloudConfig | undefined): PersistedCloudConfig | undefined {
  if (!value) return undefined;
  if (value.version !== 1 || !value.projectUrl || !value.projectRef || !value.publishableKey ||
      !['manual_publishable_key', 'oauth_pkce'].includes(value.authMode)) {
    throw new Error('Cloud configuration is malformed');
  }
  const url = validateProjectUrl(value.projectUrl);
  const key = assertPublicDataPlaneKey(value.publishableKey);
  return { ...value, projectUrl: url, publishableKey: key };
}

function redactedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Cloud request failed';
  return message.replace(/(?:eyJ|sb_(?:publishable|secret)_)[A-Za-z0-9._-]+/g, '[redacted]');
}

export class CloudController {
  readonly #store: AtomicConfigStore<PersistedCloudConfig>;
  readonly #vault: CredentialVault;
  readonly #schemaPath: string;
  readonly #collector: CollectorCoreFacade;
  readonly #fetch: typeof fetch;
  readonly #management?: SupabaseManagementClient;
  readonly #randomBytes: (size: number) => Buffer;
  readonly #randomUuid: () => string;
  readonly #now: () => number;
  readonly #manualSetupTtlMs: number;
  #config?: PersistedCloudConfig;
  #session?: AuthSession;
  #syncTimer?: NodeJS.Timeout;
  #syncing?: Promise<void>;
  #pendingManualSetup?: PendingManualSetup;
  #pendingManualSetupTimer?: NodeJS.Timeout;
  #manualSetupPreparing = false;
  #activeManualClaimSecret?: Buffer;
  #closed = false;

  constructor(options: CloudControllerOptions) {
    this.#store = new AtomicConfigStore(options.configPath);
    this.#vault = new CredentialVault(options.safeStorage, options.credentialPath);
    this.#schemaPath = options.schemaPath;
    this.#collector = options.collector;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#randomBytes = options.randomBytesImpl ?? randomBytes;
    this.#randomUuid = options.randomUuidImpl ?? randomUUID;
    this.#now = options.now ?? Date.now;
    this.#manualSetupTtlMs = options.manualSetupTtlMs ?? MANUAL_SETUP_TTL_MS;
    if (!Number.isFinite(this.#manualSetupTtlMs) || this.#manualSetupTtlMs <= 0 ||
        this.#manualSetupTtlMs > MANUAL_SETUP_TTL_MS) {
      throw new Error('Manual setup expiry must be between 1ms and 10 minutes');
    }
    this.#management = options.management
      ? new SupabaseManagementClient(options.management, this.#fetch)
      : undefined;
  }

  async start(): Promise<void> {
    this.#config = parseConfig(await this.#store.read());
    if (!this.#config) return;
    await this.ensureDataSession();
    this.startSync();
  }

  settings(): CloudSettingsSnapshot {
    const value = this.#config;
    if (!value) return { configured: false };
    return {
      configured: Boolean(value.ownerId && value.memberId),
      project_url: value.projectUrl,
      project_ref: value.projectRef,
      ...(value.ownerId ? { owner_id: value.ownerId } : {}),
      ...(value.memberId ? { member_id: value.memberId } : {}),
      auth_mode: value.authMode,
    };
  }

  beginOAuth(): { readonly authorization_url: string; readonly state: string; readonly expires_at: string } {
    if (!this.#management) throw new Error('Supabase management OAuth is not configured in this build');
    const result = this.#management.beginOAuth();
    return { authorization_url: result.authorizationUrl, state: result.state, expires_at: result.expiresAt };
  }

  async completeAuthorization(callbackUrl: string): Promise<void> {
    if (!this.#management) throw new Error('Supabase management OAuth is not configured in this build');
    await this.#management.completeAuthorization(callbackUrl);
  }

  async listProjects(): Promise<readonly ManagementProject[]> {
    if (!this.#management) throw new Error('Supabase management OAuth is not configured in this build');
    return this.#management.listProjects();
  }

  async selectProject(projectId: string): Promise<CloudSettingsSnapshot> {
    if (!this.#management) throw new Error('Supabase management OAuth is not configured in this build');
    try {
      const selected = await this.#management.selectProject(projectId);
      const schema = await readFile(this.#schemaPath, 'utf8');
      await this.#management.applySchema(selected.projectId, schema);
      const bootstrapSecret = generateOwnerBootstrapSecret();
      await this.#management.installOwnerBootstrap(selected.projectId, ownerBootstrapSecretHash(bootstrapSecret));
      return await this.configure(
        selected.projectUrl, selected.publishableKey, 'oauth_pkce', selected.projectRef, bootstrapSecret,
      );
    } finally {
      this.#management.clearManagementSession();
    }
  }

  async beginManualSetup(rawUrl: string, rawKey: string): Promise<ManualCloudSetup> {
    this.expirePendingManualSetup();
    if (this.#closed) throw new Error('Cloud controller is closed');
    if (this.#pendingManualSetup || this.#manualSetupPreparing) {
      throw new Error('A manual cloud setup is already pending');
    }
    this.#manualSetupPreparing = true;
    try {
      return await this.prepareManualSetup(rawUrl, rawKey);
    } finally {
      this.#manualSetupPreparing = false;
    }
  }

  private async prepareManualSetup(rawUrl: string, rawKey: string): Promise<ManualCloudSetup> {
    const projectUrl = validateProjectUrl(rawUrl);
    const publishableKey = assertPublicDataPlaneKey(rawKey);
    if (this.#config?.projectUrl === projectUrl && this.#config.publishableKey === publishableKey &&
        this.#config.ownerId && this.#config.memberId) {
      throw new Error('This Supabase project is already connected');
    }
    const schema = await readFile(this.#schemaPath, 'utf8');
    if (this.#closed) throw new Error('Cloud controller is closed');
    if (!schema.trim()) throw new Error('Checked-in Supabase schema is empty');
    if (Buffer.byteLength(schema, 'utf8') > MAX_SETUP_SQL_BYTES) {
      throw new Error('Checked-in Supabase schema exceeds the setup size limit');
    }

    const id = this.#randomUuid();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Secure manual setup identifier generation failed');
    }
    const startedAtMs = this.#now();
    if (!Number.isFinite(startedAtMs)) throw new Error('Manual setup clock is unavailable');

    const secret = this.#randomBytes(32);
    if (!Buffer.isBuffer(secret) || secret.length !== 32) {
      secret.fill?.(0);
      throw new Error('Secure manual setup secret generation failed');
    }
    let setupSql: string;
    try {
      const rawSecret = secret.toString('base64url');
      const digest = createHash('sha256').update(rawSecret, 'utf8').digest('hex');
      const bootstrapSql = `select public.install_owner_bootstrap(decode('${digest}', 'hex'));`;
      setupSql = `${schema.trimEnd()}\n\n${bootstrapSql}\n`;
      if (Buffer.byteLength(setupSql, 'utf8') > MAX_SETUP_SQL_BYTES + 256) {
        throw new Error('Generated Supabase setup SQL exceeds the response size limit');
      }
    } catch (error) {
      secret.fill(0);
      throw error;
    }

    const pending: PendingManualSetup = {
      id,
      projectUrl,
      projectRef: projectRef(projectUrl),
      publishableKey,
      secret,
      expiresAtMs: startedAtMs + this.#manualSetupTtlMs,
    };
    this.#pendingManualSetup = pending;
    this.#pendingManualSetupTimer = setTimeout(() => {
      if (this.#pendingManualSetup?.id === pending.id) this.clearPendingManualSetup();
    }, this.#manualSetupTtlMs);
    this.#pendingManualSetupTimer.unref?.();
    return {
      setup_id: pending.id,
      project_ref: pending.projectRef,
      expires_at: new Date(pending.expiresAtMs).toISOString(),
      setup_sql: setupSql,
    };
  }

  async confirmManualSetup(setupId: string, rawProjectUrl: string): Promise<CloudSettingsSnapshot> {
    this.expirePendingManualSetup();
    if (this.#closed) throw new Error('Cloud controller is closed');
    const pending = this.#pendingManualSetup;
    if (!pending) throw new Error('Manual cloud setup is unavailable, expired, or already consumed');
    this.#pendingManualSetup = undefined;
    if (this.#pendingManualSetupTimer) clearTimeout(this.#pendingManualSetupTimer);
    this.#pendingManualSetupTimer = undefined;
    this.#activeManualClaimSecret = pending.secret;
    try {
      const projectUrl = validateProjectUrl(rawProjectUrl);
      if (setupId !== pending.id || projectUrl !== pending.projectUrl) {
        throw new Error('Manual cloud setup does not match the pending project');
      }
      return await this.configure(
        pending.projectUrl,
        pending.publishableKey,
        'manual_publishable_key',
        pending.projectRef,
        pending.secret.toString('base64url'),
      );
    } finally {
      pending.secret.fill(0);
      if (this.#activeManualClaimSecret === pending.secret) this.#activeManualClaimSecret = undefined;
    }
  }

  async createPairing(deviceLabel = 'Tok-kie Web Viewer'): Promise<PairingQrV2> {
    const config = this.requireProvisionedConfig();
    await this.ensureDataSession();
    return new PairingAdministrationService({
      projectUrl: config.projectUrl,
      publishableKey: config.publishableKey,
      getAccessToken: () => this.#session?.accessToken,
      getOwnerId: () => this.#config?.ownerId,
      fetchImpl: this.#fetch,
    }).createPairingToken('viewer', deviceLabel);
  }

  async listPendingMembers(): Promise<readonly SanitizedCloudMember[]> {
    await this.ensureDataSession();
    const members = await this.pairingAdministration().listPendingMembers();
    return members.map((member) => ({
      id: member.id, role: member.role, display_name: member.displayName, created_at: member.createdAt,
    }));
  }

  async listMembers(): Promise<readonly SanitizedCloudMember[]> {
    await this.ensureDataSession();
    const members = await this.pairingAdministration().listMembers();
    return members.map((member) => ({
      id: member.id, role: member.role, display_name: member.displayName, created_at: member.createdAt,
      ...(member.approvedAt ? { approved_at: member.approvedAt } : {}),
    }));
  }

  async approveMember(memberId: string): Promise<void> {
    await this.ensureDataSession();
    await this.pairingAdministration().approveMember(memberId);
  }

  async revokeMember(memberId: string): Promise<void> {
    await this.ensureDataSession();
    await this.pairingAdministration().revokeMember(memberId);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.clearPendingManualSetup();
    this.#activeManualClaimSecret?.fill(0);
    this.#activeManualClaimSecret = undefined;
    if (this.#syncTimer) clearInterval(this.#syncTimer);
    this.#syncTimer = undefined;
    await this.#syncing;
    this.#session = undefined;
    this.#management?.clearManagementSession();
  }

  private expirePendingManualSetup(): void {
    if (this.#pendingManualSetup && this.#pendingManualSetup.expiresAtMs <= this.#now()) {
      this.clearPendingManualSetup();
    }
  }

  private clearPendingManualSetup(): void {
    if (this.#pendingManualSetupTimer) clearTimeout(this.#pendingManualSetupTimer);
    this.#pendingManualSetupTimer = undefined;
    this.#pendingManualSetup?.secret.fill(0);
    this.#pendingManualSetup = undefined;
  }

  private async configure(
    rawUrl: string,
    rawKey: string,
    authMode: PersistedCloudConfig['authMode'],
    selectedRef?: string,
    bootstrapSecret?: string,
  ): Promise<CloudSettingsSnapshot> {
    const projectUrl = validateProjectUrl(rawUrl);
    const publishableKey = assertPublicDataPlaneKey(rawKey);
    const previous = this.#config;
    const sameProject = previous?.projectUrl === projectUrl && previous.publishableKey === publishableKey;
    const candidate: PersistedCloudConfig = {
      version: 1,
      projectUrl,
      projectRef: selectedRef ?? projectRef(projectUrl),
      publishableKey,
      authMode,
      ...(sameProject && previous?.ownerId ? { ownerId: previous.ownerId } : {}),
      ...(sameProject && previous?.memberId ? { memberId: previous.memberId } : {}),
    };
    if (sameProject && candidate.ownerId && candidate.memberId) {
      this.#config = candidate;
      await this.#store.write(candidate);
      await this.ensureDataSession();
      this.startSync();
      return this.settings();
    }
    if (!bootstrapSecret) {
      throw new Error('Manual setup requires an administrator-installed one-time owner bootstrap secret');
    }
    const secret = validateOwnerBootstrapSecret(bootstrapSecret);
    const previousSession = this.#session;
    const previousRefreshToken = await this.#vault.load();
    let credentialSaved = false;
    this.#config = candidate;
    this.#session = undefined;
    try {
      const session = await this.auth('/signup', { data: {}, gotrue_meta_security: {} });
      this.#session = session;
      const identity = await this.claimOwnerBootstrap(secret);
      this.#config = { ...candidate, ownerId: identity.ownerId, memberId: identity.memberId };
      await this.#vault.save(session.refreshToken);
      credentialSaved = true;
      await this.#store.write(this.#config);
    } catch (error) {
      this.#config = previous;
      this.#session = previousSession;
      if (credentialSaved) {
        await (previousRefreshToken
          ? this.#vault.save(previousRefreshToken)
          : this.#vault.clear()).catch(() => undefined);
        await (previous ? this.#store.write(previous) : this.#store.clear()).catch(() => undefined);
      }
      throw error;
    }
    this.startSync();
    return this.settings();
  }

  private pairingAdministration(): PairingAdministrationService {
    const config = this.requireProvisionedConfig();
    return new PairingAdministrationService({
      projectUrl: config.projectUrl,
      publishableKey: config.publishableKey,
      getAccessToken: () => this.#session?.accessToken,
      getOwnerId: () => this.#config?.ownerId,
      fetchImpl: this.#fetch,
    });
  }

  private requireConfig(): PersistedCloudConfig {
    if (!this.#config) throw new Error('Cloud is not configured');
    return this.#config;
  }

  private requireProvisionedConfig(): PersistedCloudConfig & { ownerId: string; memberId: string } {
    const config = this.requireConfig();
    if (!config.ownerId || !config.memberId) throw new Error('Cloud owner is not provisioned');
    return config as PersistedCloudConfig & { ownerId: string; memberId: string };
  }

  private async ensureDataSession(): Promise<AuthSession> {
    const config = this.requireConfig();
    if (this.#session && this.#session.expiresAtMs > Date.now() + SESSION_SKEW_MS) return this.#session;

    const refreshToken = await this.#vault.load();
    let session: AuthSession;
    if (refreshToken) {
      try {
        session = await this.auth('/token?grant_type=refresh_token', { refresh_token: refreshToken });
      } catch (error) {
        if (config.ownerId || config.memberId) throw new Error(`Stored cloud session could not be refreshed: ${redactedMessage(error)}`);
        throw new Error('Cloud owner bootstrap proof is required');
      }
    } else {
      if (config.ownerId || config.memberId) throw new Error('Stored cloud session is unavailable; reconnect this project');
      throw new Error('Cloud owner bootstrap proof is required');
    }
    this.#session = session;
    await this.#vault.save(session.refreshToken);

    if (!config.ownerId || !config.memberId) throw new Error('Cloud owner bootstrap proof is required');
    return session;
  }

  private async claimOwnerBootstrap(secret: string): Promise<{ ownerId: string; memberId: string }> {
    const config = this.requireConfig();
    const accessToken = this.#session?.accessToken;
    if (!accessToken) throw new Error('Data-plane bootstrap session is unavailable');
    const response = await this.#fetch(new URL('/rest/v1/rpc/claim_owner_bootstrap', config.projectUrl), {
      method: 'POST', redirect: 'error',
      headers: {
        apikey: config.publishableKey, authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json', accept: 'application/json',
      },
      body: JSON.stringify({ p_one_time_secret: secret, p_display_name: 'Tok-kie Owner' }),
    });
    if (!response.ok) throw new Error(`Owner bootstrap failed with HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || payload.length !== 1 || !payload[0] || typeof payload[0] !== 'object') {
      throw new Error('Owner bootstrap proof was rejected or already consumed');
    }
    const row = payload[0] as Record<string, unknown>;
    const ownerId = checkedString(row.owner_id, 'owner_id');
    const memberId = checkedString(row.member_id, 'member_id');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(ownerId) || !uuid.test(memberId)) throw new Error('Owner bootstrap returned malformed identity');
    return { ownerId, memberId };
  }

  private async auth(pathname: string, body: Record<string, unknown>): Promise<AuthSession> {
    const config = this.requireConfig();
    const response = await this.#fetch(new URL(`/auth/v1${pathname}`, config.projectUrl), {
      method: 'POST',
      headers: { apikey: config.publishableKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Supabase authentication failed with HTTP ${response.status}`);
    const payload = await response.json() as AuthResponse;
    const accessToken = checkedString(payload.access_token, 'access_token');
    const refreshToken = checkedString(payload.refresh_token, 'refresh_token');
    const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? payload.expires_in : 3600;
    return { accessToken, refreshToken, expiresAtMs: Date.now() + Math.max(60, expiresIn) * 1000 };
  }

  private startSync(): void {
    if (this.#syncTimer) return;
    this.#syncTimer = setInterval(() => void this.syncOnce(), 30_000);
    this.#syncTimer.unref?.();
    void this.syncOnce();
  }

  private syncOnce(): Promise<void> {
    if (this.#syncing) return this.#syncing;
    this.#syncing = this.performSync().finally(() => { this.#syncing = undefined; });
    return this.#syncing;
  }

  private async performSync(): Promise<void> {
    let config: PersistedCloudConfig & { ownerId: string; memberId: string };
    try {
      config = this.requireProvisionedConfig();
    } catch {
      return;
    }
    const session = await this.ensureDataSession();
    const client = new SupabaseSyncClient({
      projectUrl: config.projectUrl,
      publishableKey: config.publishableKey,
      getAccessToken: () => this.#session?.accessToken,
      fetchImpl: this.#fetch,
    });
    for (const entry of await this.#collector.outboxDue(50)) {
      try {
        await client.push([mapOutboxEntry(entry, { ownerId: config.ownerId, memberId: config.memberId })]);
        await this.#collector.acknowledgeOutbox(entry.operation_id, entry.payload_hash);
      } catch (error) {
        await this.#collector.failOutbox(entry.operation_id, redactedMessage(error));
      }
    }
    void session;
  }
}
