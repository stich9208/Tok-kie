import { createHash, randomBytes } from 'node:crypto';

export const OAUTH_CALLBACK = 'tokkie://oauth/callback';
const DEFAULT_TTL_MS = 5 * 60_000;

export interface OAuthAttempt {
  readonly state: string;
  readonly verifier: string;
  readonly expiresAtMs: number;
}

export interface ValidOAuthCallback {
  readonly state: string;
  readonly code?: string;
  readonly error?: string;
  readonly errorDescription?: string;
}

export interface OAuthStartOptions {
  readonly authorizationEndpoint: string;
  readonly allowedAuthorizationOrigins: readonly string[];
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly redirectUri?: string;
  readonly nowMs?: number;
  readonly ttlMs?: number;
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function exactAllowedHttpsUrl(raw: string, origins: readonly string[]): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('OAuth endpoint must be a plain HTTPS URL');
  }
  const allowed = new Set(origins.map((origin) => new URL(origin).origin));
  if (!allowed.has(url.origin)) throw new Error('OAuth authorization origin is not allowlisted');
  return url;
}

export function validateOAuthCallback(raw: string): ValidOAuthCallback {
  const url = new URL(raw);
  if (url.protocol !== 'tokkie:' || url.hostname !== 'oauth' || url.pathname !== '/callback' ||
      url.port || url.username || url.password || url.hash) {
    throw new Error('OAuth callback must exactly match tokkie://oauth/callback');
  }
  const allowed = new Set(['code', 'state', 'error', 'error_description']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`OAuth callback contains unsupported parameter: ${key}`);
    if (url.searchParams.getAll(key).length !== 1) throw new Error(`OAuth callback repeats parameter: ${key}`);
  }
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code') ?? undefined;
  const error = url.searchParams.get('error') ?? undefined;
  if (!state || (!code && !error) || (code && error)) throw new Error('OAuth callback is incomplete');
  return {
    state,
    code,
    error,
    errorDescription: url.searchParams.get('error_description') ?? undefined,
  };
}

/** Main-process-only, single-use PKCE attempt registry. */
export class OAuthAttemptRegistry {
  readonly #attempts = new Map<string, OAuthAttempt>();

  begin(options: OAuthStartOptions): { readonly attempt: OAuthAttempt; readonly authorizationUrl: string } {
    const now = options.nowMs ?? Date.now();
    const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > DEFAULT_TTL_MS) throw new Error('OAuth TTL must be at most five minutes');
    this.prune(now);
    const endpoint = exactAllowedHttpsUrl(options.authorizationEndpoint, options.allowedAuthorizationOrigins);
    const redirectUri = options.redirectUri ?? OAUTH_CALLBACK;
    if (redirectUri !== OAUTH_CALLBACK) throw new Error('Unexpected OAuth redirect URI');
    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(32));
    const attempt: OAuthAttempt = { state, verifier, expiresAtMs: now + ttl };
    this.#attempts.set(state, attempt);
    endpoint.searchParams.set('response_type', 'code');
    endpoint.searchParams.set('client_id', options.clientId);
    endpoint.searchParams.set('redirect_uri', redirectUri);
    endpoint.searchParams.set('state', state);
    endpoint.searchParams.set('code_challenge_method', 'S256');
    endpoint.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    endpoint.searchParams.set('scope', options.scopes.join(' '));
    return { attempt, authorizationUrl: endpoint.toString() };
  }

  consume(callback: ValidOAuthCallback, nowMs = Date.now()): OAuthAttempt {
    const attempt = this.#attempts.get(callback.state);
    if (!attempt) throw new Error('OAuth state mismatch or replay');
    this.#attempts.delete(callback.state);
    if (attempt.expiresAtMs <= nowMs) throw new Error('OAuth attempt expired');
    return attempt;
  }

  clear(): void {
    this.#attempts.clear();
  }

  private prune(nowMs: number): void {
    for (const [state, attempt] of this.#attempts) {
      if (attempt.expiresAtMs <= nowMs) this.#attempts.delete(state);
    }
  }
}

