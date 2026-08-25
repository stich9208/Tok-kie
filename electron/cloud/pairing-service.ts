import { assertPublicDataPlaneKey } from './keys';
import { buildPairingQrV2, validateProjectUrl } from './pairing';
import type { PairingQrV2 } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PairingRole = 'viewer' | 'device';

export interface PendingMember {
  readonly id: string;
  readonly ownerId: string;
  readonly role: PairingRole;
  readonly displayName: string;
  readonly createdAt: string;
  readonly approvedAt?: string;
}

export class CloudDataPlaneUnavailableError extends Error {
  readonly code = 'UNAVAILABLE' as const;
  constructor(message: string) {
    super(message);
    this.name = 'CloudDataPlaneUnavailableError';
  }
}

export interface PairingAdministrationOptions {
  readonly projectUrl: string;
  readonly publishableKey: string;
  /** Must return the current signed-in owner JWT. It is called per request and never cached. */
  readonly getAccessToken: () => string | undefined;
  /** Owner bootstrap is product-owned; undefined means this API is unavailable. */
  readonly getOwnerId: () => string | undefined;
  readonly fetchImpl?: typeof fetch;
}

function parseAuthenticatedJwt(raw: string | undefined): string {
  if (!raw) throw new CloudDataPlaneUnavailableError('An authenticated owner session is required');
  try {
    const parts = raw.split('.');
    const claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    if (parts.length !== 3 || claims.role !== 'authenticated' || typeof claims.sub !== 'string') throw new Error('bad claims');
    return raw;
  } catch {
    throw new CloudDataPlaneUnavailableError('The data-plane session is not an authenticated user JWT');
  }
}

function ownerId(getOwnerId: () => string | undefined): string {
  const value = getOwnerId();
  if (!value || !UUID.test(value)) {
    throw new CloudDataPlaneUnavailableError('Owner login and tenant bootstrap are not configured');
  }
  return value;
}

function boundedName(value: string): string {
  const result = value.trim();
  if (!result || result.length > 120) throw new Error('Pairing display name must be 1-120 characters');
  return result;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} is malformed`);
  return value;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is malformed`);
  return new Date(Date.parse(value)).toISOString();
}

/** Main-process owner administration over authenticated Supabase REST/RPC only. */
export class PairingAdministrationService {
  readonly #origin: string;
  readonly #publishableKey: string;
  readonly #getAccessToken: () => string | undefined;
  readonly #getOwnerId: () => string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: PairingAdministrationOptions) {
    this.#origin = validateProjectUrl(options.projectUrl);
    this.#publishableKey = assertPublicDataPlaneKey(options.publishableKey);
    this.#getAccessToken = options.getAccessToken;
    this.#getOwnerId = options.getOwnerId;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async createPairingToken(role: PairingRole, displayName: string, nowMs = Date.now()): Promise<PairingQrV2> {
    if (role !== 'viewer' && role !== 'device') throw new Error('Pairing role must be viewer or device');
    const currentOwnerId = ownerId(this.#getOwnerId);
    const response = await this.request(new URL('/rest/v1/rpc/create_pairing_token', this.#origin), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_owner_id: currentOwnerId,
        p_requested_role: role,
        p_display_name: boundedName(displayName),
      }),
    });
    const payload = await this.json(response, 'Create pairing token');
    if (!Array.isArray(payload) || payload.length !== 1 || !payload[0] || typeof payload[0] !== 'object') {
      throw new Error('Create pairing token returned an invalid result');
    }
    const row = payload[0] as Record<string, unknown>;
    if (typeof row.one_time_secret !== 'string') throw new Error('Create pairing token omitted its one-time secret');
    return buildPairingQrV2({
      projectUrl: this.#origin,
      pairingId: uuid(row.pairing_id, 'pairing_id'),
      oneTimeSecret: row.one_time_secret,
      expiresAt: iso(row.expires_at, 'expires_at'),
    }, nowMs);
  }

  async listPendingMembers(): Promise<readonly PendingMember[]> {
    return (await this.listMembers()).filter((member) => member.approvedAt === undefined);
  }

  /** Active viewer/device members, including approved rows so revocation remains reachable. */
  async listMembers(): Promise<readonly PendingMember[]> {
    const currentOwnerId = ownerId(this.#getOwnerId);
    const url = new URL('/rest/v1/members', this.#origin);
    url.searchParams.set('select', 'id,owner_id,role,display_name,created_at,approved_at');
    url.searchParams.set('owner_id', `eq.${currentOwnerId}`);
    url.searchParams.set('revoked_at', 'is.null');
    url.searchParams.set('role', 'in.(viewer,device)');
    url.searchParams.set('order', 'created_at.asc,id.asc');
    const payload = await this.json(await this.request(url), 'Pending member listing');
    if (!Array.isArray(payload)) throw new Error('Pending member listing is malformed');
    return payload.map((item): PendingMember => {
      if (!item || typeof item !== 'object') throw new Error('Pending member listing contains an invalid row');
      const row = item as Record<string, unknown>;
      const rowOwnerId = uuid(row.owner_id, 'pending owner_id');
      if (rowOwnerId !== currentOwnerId) throw new Error('Pending member response crossed the owner boundary');
      if (row.role !== 'viewer' && row.role !== 'device') throw new Error('Pending member role is invalid');
      return {
        id: uuid(row.id, 'pending member id'), ownerId: rowOwnerId, role: row.role,
        displayName: typeof row.display_name === 'string' ? boundedName(row.display_name) : (() => { throw new Error('Pending member display name is invalid'); })(),
        createdAt: iso(row.created_at, 'pending member created_at'),
        ...(row.approved_at === null || row.approved_at === undefined
          ? {} : { approvedAt: iso(row.approved_at, 'member approved_at') }),
      };
    });
  }

  approveMember(memberId: string): Promise<void> {
    return this.changeMember('approve_member', memberId);
  }

  revokeMember(memberId: string): Promise<void> {
    return this.changeMember('revoke_member', memberId);
  }

  private async changeMember(rpc: 'approve_member' | 'revoke_member', memberId: string): Promise<void> {
    const currentOwnerId = ownerId(this.#getOwnerId);
    const response = await this.request(new URL(`/rest/v1/rpc/${rpc}`, this.#origin), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ p_owner_id: currentOwnerId, p_member_id: uuid(memberId, 'member id') }),
    });
    const changed = await this.json(response, rpc === 'approve_member' ? 'Approve member' : 'Revoke member');
    if (changed !== true) throw new Error('Member was not found or is not eligible for this transition');
  }

  private request(url: URL, init: RequestInit = {}): Promise<Response> {
    const accessToken = parseAuthenticatedJwt(this.#getAccessToken());
    const headers = new Headers(init.headers);
    headers.set('apikey', this.#publishableKey);
    headers.set('authorization', `Bearer ${accessToken}`);
    headers.set('accept', 'application/json');
    return this.#fetch(url, { ...init, headers, redirect: 'error' });
  }

  private async json(response: Response, operation: string): Promise<unknown> {
    if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (!type.toLowerCase().includes('application/json')) throw new Error(`${operation} returned an unexpected content type`);
    return response.json();
  }
}
