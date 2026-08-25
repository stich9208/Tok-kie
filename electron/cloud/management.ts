import { OAuthAttemptRegistry, OAUTH_CALLBACK, validateOAuthCallback } from './oauth';
import { selectPublishableKey, type ManagementApiKey } from './keys';
import { validateProjectUrl } from './pairing';
import type {
  BeginOAuthResult,
  CloudProvisioningApi,
  CompleteAuthorizationResult,
  ManagementProject,
  SelectedCloudProject,
} from './types';

export interface ManagementOAuthConfig {
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly managementApiOrigin: string;
  readonly allowedOrigins: readonly string[];
  readonly scopes: readonly string[];
}

interface TokenResponse { readonly access_token?: unknown }

function checkedHttpsUrl(raw: string, allowedOrigins: readonly string[]): URL {
  const url = new URL(raw);
  const origins = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !origins.has(url.origin)) {
    throw new Error('Management endpoint is not allowlisted');
  }
  return url;
}

async function checkedJson(response: Response, operation: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${operation} returned an unexpected content type`);
  }
  return response.json();
}

/** Management-plane OAuth/provisioning. The access token has no persistence API. */
export class SupabaseManagementClient implements CloudProvisioningApi {
  readonly #attempts = new OAuthAttemptRegistry();
  readonly #config: ManagementOAuthConfig;
  readonly #fetch: typeof fetch;
  #accessToken: string | undefined;
  #projects: readonly ManagementProject[] = [];

  constructor(config: ManagementOAuthConfig, fetchImpl: typeof fetch = fetch) {
    checkedHttpsUrl(config.authorizationEndpoint, config.allowedOrigins);
    checkedHttpsUrl(config.tokenEndpoint, config.allowedOrigins);
    checkedHttpsUrl(config.managementApiOrigin, config.allowedOrigins);
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  beginOAuth(): BeginOAuthResult {
    const { attempt, authorizationUrl } = this.#attempts.begin({
      authorizationEndpoint: this.#config.authorizationEndpoint,
      allowedAuthorizationOrigins: this.#config.allowedOrigins,
      clientId: this.#config.clientId,
      scopes: this.#config.scopes,
    });
    return { authorizationUrl, state: attempt.state, expiresAt: new Date(attempt.expiresAtMs).toISOString() };
  }

  async completeAuthorization(callbackUrl: string): Promise<CompleteAuthorizationResult> {
    const callback = validateOAuthCallback(callbackUrl);
    const attempt = this.#attempts.consume(callback);
    if (callback.error) throw new Error(`OAuth authorization failed: ${callback.error}`);
    const endpoint = checkedHttpsUrl(this.#config.tokenEndpoint, this.#config.allowedOrigins);
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code: callback.code!, client_id: this.#config.clientId,
      redirect_uri: OAUTH_CALLBACK, code_verifier: attempt.verifier,
    });
    const response = await this.#fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(), redirect: 'error',
    });
    const token = await checkedJson(response, 'OAuth token exchange') as TokenResponse;
    if (typeof token.access_token !== 'string' || token.access_token.length < 20) {
      throw new Error('OAuth token exchange omitted the access token');
    }
    this.#accessToken = token.access_token;
    this.#projects = await this.fetchProjects();
    return { projects: this.#projects };
  }

  async listProjects(): Promise<readonly ManagementProject[]> {
    this.#projects = await this.fetchProjects();
    return this.#projects;
  }

  async selectProject(projectId: string): Promise<SelectedCloudProject> {
    if (!projectId) throw new Error('An explicit project selection is required');
    const projects = await this.listProjects();
    const selected = projects.find((project) => project.id === projectId);
    if (!selected) throw new Error('Selected project is not in the authorized project list');
    const endpoint = this.apiUrl(`/v1/projects/${encodeURIComponent(selected.ref)}/api-keys`);
    const payload = await checkedJson(await this.authorizedFetch(endpoint), 'Project API key listing');
    if (!Array.isArray(payload)) throw new Error('Project API key listing is malformed');
    const publishableKey = selectPublishableKey(payload as ManagementApiKey[]);
    return {
      projectId: selected.id,
      projectRef: selected.ref,
      projectUrl: validateProjectUrl(`https://${selected.ref}.supabase.co`),
      publishableKey,
    };
  }

  async applySchema(projectId: string, sql: string): Promise<void> {
    if (!sql.trim()) throw new Error('Schema SQL must not be empty');
    const projects = await this.listProjects();
    const selected = projects.find((project) => project.id === projectId);
    if (!selected) throw new Error('Selected project is not in the authorized project list');
    const endpoint = this.apiUrl(`/v1/projects/${encodeURIComponent(selected.ref)}/database/query`);
    const response = await this.authorizedFetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: sql }),
    });
    if (!response.ok) throw new Error(`Schema apply failed with HTTP ${response.status}`);
  }

  async installOwnerBootstrap(projectId: string, secretSha256: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(secretSha256)) throw new Error('Bootstrap secret digest is malformed');
    const projects = await this.listProjects();
    const selected = projects.find((project) => project.id === projectId);
    if (!selected) throw new Error('Selected project is not in the authorized project list');
    const endpoint = this.apiUrl(`/v1/projects/${encodeURIComponent(selected.ref)}/database/query`);
    // The validated fixed-width hex value is the only interpolation. install_owner_bootstrap
    // is deliberately not executable by anon/authenticated data-plane roles.
    const query = `select public.install_owner_bootstrap(decode('${secretSha256}', 'hex'))`;
    const response = await this.authorizedFetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
    });
    if (!response.ok) throw new Error(`Owner bootstrap installation failed with HTTP ${response.status}`);
  }

  clearManagementSession(): void {
    this.#accessToken = undefined;
    this.#projects = [];
    this.#attempts.clear();
  }

  private async fetchProjects(): Promise<readonly ManagementProject[]> {
    const payload = await checkedJson(await this.authorizedFetch(this.apiUrl('/v1/projects')), 'Project listing');
    if (!Array.isArray(payload)) throw new Error('Project listing is malformed');
    return payload.map((item): ManagementProject => {
      if (!item || typeof item !== 'object') throw new Error('Project listing contains a malformed project');
      const value = item as Record<string, unknown>;
      const id = value.id;
      const ref = value.ref;
      const name = value.name;
      if (typeof id !== 'string' || typeof ref !== 'string' || !/^[a-z0-9-]{5,64}$/i.test(ref) || typeof name !== 'string') {
        throw new Error('Project listing contains invalid project identity');
      }
      return { id, ref, name, organizationId: typeof value.organization_id === 'string' ? value.organization_id : undefined };
    });
  }

  private apiUrl(path: string): URL {
    const base = checkedHttpsUrl(this.#config.managementApiOrigin, this.#config.allowedOrigins);
    return new URL(path, `${base.origin}/`);
  }

  private authorizedFetch(url: URL, init: RequestInit = {}): Promise<Response> {
    if (!this.#accessToken) throw new Error('Management OAuth session is not authorized');
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.#accessToken}`);
    headers.set('accept', 'application/json');
    return this.#fetch(url, { ...init, headers, redirect: 'error' });
  }
}
