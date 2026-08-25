import { assertPublicDataPlaneKey } from './keys';
import { validateProjectUrl } from './pairing';

export type CloudEntity = 'sessions' | 'steps';

export interface SyncEnvelope {
  readonly entity: CloudEntity;
  readonly owner_id: string;
  readonly id: string;
  readonly created_by_member_id: string;
  readonly payload_version: number;
  readonly payload_hash: string;
  /** Whitelisted persistence fields only; source paths, prompt previews and tool args are prohibited. */
  readonly fields: Readonly<Record<string, string | number | boolean | null | object>>;
  readonly deleted_at?: string;
}

export interface ReconcilePage {
  readonly rows: readonly Record<string, unknown>[];
  readonly nextCursor?: string;
}

const FORBIDDEN_FIELDS = new Set([
  'locator', 'path', 'rawprompt', 'prompt', 'previewtext', 'toolarguments', 'toolargs',
  'oauthtoken', 'accesstoken', 'refreshtoken', 'publishablekey',
]);

function assertCloudSafeJson(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('Cloud payload is nested too deeply');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cloud payload contains a non-finite number');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCloudSafeJson(item, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Cloud payload contains a non-JSON value');
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_FIELDS.has(normalized)) throw new Error(`Forbidden cloud field: ${key}`);
    assertCloudSafeJson(child, depth + 1);
  }
}

function validateEnvelope(envelope: SyncEnvelope): Record<string, unknown> {
  if (!['sessions','steps'].includes(envelope.entity) || !envelope.owner_id || !envelope.id ||
      !envelope.created_by_member_id || !Number.isInteger(envelope.payload_version) || envelope.payload_version < 1 ||
      !/^[a-f0-9]{64}$/.test(envelope.payload_hash)) throw new Error('Invalid outbox envelope');
  assertCloudSafeJson(envelope.fields);
  return {
    ...envelope.fields,
    owner_id: envelope.owner_id,
    id: envelope.id,
    created_by_member_id: envelope.created_by_member_id,
    payload_version: envelope.payload_version,
    payload_hash: envelope.payload_hash,
    deleted_at: envelope.deleted_at ?? null,
  };
}

export class SupabaseSyncClient {
  readonly #origin: string;
  readonly #publishableKey: string;
  readonly #getAccessToken: () => string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: {
    readonly projectUrl: string;
    readonly publishableKey: string;
    readonly getAccessToken: () => string | undefined;
    readonly fetchImpl?: typeof fetch;
  }) {
    this.#origin = validateProjectUrl(options.projectUrl);
    this.#publishableKey = assertPublicDataPlaneKey(options.publishableKey);
    this.#getAccessToken = options.getAccessToken;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async push(envelopes: readonly SyncEnvelope[]): Promise<void> {
    for (const envelope of envelopes) {
      const row = validateEnvelope(envelope);
      const url = new URL('/rest/v1/rpc/apply_cloud_sync', this.#origin);
      const response = await this.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_entity: envelope.entity,
          p_owner_id: envelope.owner_id,
          p_id: envelope.id,
          p_created_by_member_id: envelope.created_by_member_id,
          p_payload_version: envelope.payload_version,
          p_payload_hash: envelope.payload_hash,
          p_fields: row,
          p_deleted_at: envelope.deleted_at ?? null,
        }),
      });
      if (!response.ok) throw new Error(`Cloud sync failed with HTTP ${response.status}`);
      const result: unknown = await response.json();
      if (result !== 'applied' && result !== 'idempotent' && result !== 'stale') {
        throw new Error('Cloud sync returned an invalid acknowledgement');
      }
    }
  }

  async reconcile(entity: CloudEntity, ownerId: string, afterIso?: string, limit = 500): Promise<ReconcilePage> {
    if (!ownerId || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid reconcile request');
    const url = new URL(`/rest/v1/${entity}`, this.#origin);
    url.searchParams.set('select', '*');
    url.searchParams.set('owner_id', `eq.${ownerId}`);
    if (afterIso) url.searchParams.set('cloud_updated_at', `gt.${afterIso}`);
    url.searchParams.set('order', 'cloud_updated_at.asc,id.asc');
    url.searchParams.set('limit', String(limit));
    const response = await this.request(url);
    if (!response.ok) throw new Error(`Cloud reconcile failed with HTTP ${response.status}`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Cloud reconcile response is malformed');
    const last = rows.at(-1) as Record<string, unknown> | undefined;
    return { rows: rows as Record<string, unknown>[], nextCursor: typeof last?.cloud_updated_at === 'string' ? last.cloud_updated_at : undefined };
  }

  private request(url: URL, init: RequestInit = {}): Promise<Response> {
    const accessToken = this.#getAccessToken();
    if (!accessToken) throw new Error('Signed-in data-plane session is required');
    const headers = new Headers(init.headers);
    headers.set('apikey', this.#publishableKey);
    headers.set('authorization', `Bearer ${accessToken}`);
    headers.set('accept', 'application/json');
    return this.#fetch(url, { ...init, headers, redirect: 'error' });
  }
}
