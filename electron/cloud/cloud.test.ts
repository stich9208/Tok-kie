import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPublishableKey } from './keys';
import { generateOwnerBootstrapSecret, ownerBootstrapSecretHash } from './bootstrap';
import { SupabaseManagementClient } from './management';
import { OAuthAttemptRegistry, validateOAuthCallback } from './oauth';
import { mapOutboxEntry } from './outbox-mapper';
import { SupabaseSyncClient } from './outbox';
import { decodePairingClaimToken, encodePairingClaimToken, validatePairingQrV2 } from './pairing';
import { CloudDataPlaneUnavailableError, PairingAdministrationService } from './pairing-service';
import { normalizeSession, normalizeStep } from '../../dashboard/lib/gateway/normalize';
import { validatePairingEnvelope } from '../../dashboard/lib/gateway/pairing';

const oauthOptions = {
  authorizationEndpoint: 'https://api.supabase.com/v1/oauth/authorize',
  allowedAuthorizationOrigins: ['https://api.supabase.com'],
  clientId: 'client-id',
  scopes: ['projects:read'],
  nowMs: 1_000,
};

test('OAuth state mismatch is rejected without consuming the valid attempt', () => {
  const attempts = new OAuthAttemptRegistry();
  const { attempt } = attempts.begin(oauthOptions);
  assert.throws(() => attempts.consume({ state: 'wrong', code: 'code' }, 1_001), /mismatch/);
  assert.equal(attempts.consume({ state: attempt.state, code: 'code' }, 1_001).state, attempt.state);
});

test('OAuth attempt is single-use and replay is rejected', () => {
  const attempts = new OAuthAttemptRegistry();
  const { attempt } = attempts.begin(oauthOptions);
  attempts.consume({ state: attempt.state, code: 'code' }, 1_001);
  assert.throws(() => attempts.consume({ state: attempt.state, code: 'code' }, 1_002), /replay/);
});

test('expired OAuth attempt is rejected and consumed', () => {
  const attempts = new OAuthAttemptRegistry();
  const { attempt } = attempts.begin({ ...oauthOptions, ttlMs: 10 });
  assert.throws(() => attempts.consume({ state: attempt.state, code: 'code' }, 1_011), /expired/);
  assert.throws(() => attempts.consume({ state: attempt.state, code: 'code' }, 1_012), /replay/);
});

test('callback validation requires exact scheme, host, path and parameters', () => {
  assert.deepEqual(
    validateOAuthCallback('tokkie://oauth/callback?code=abc&state=state'),
    { code: 'abc', state: 'state', error: undefined, errorDescription: undefined },
  );
  for (const invalid of [
    'tokkie://evil/callback?code=abc&state=state',
    'tokkie://oauth/callback/extra?code=abc&state=state',
    'tokkie://oauth/callback?code=abc&state=state&extra=1',
    'tokkie://oauth/callback?code=abc&code=def&state=state',
    'tokkie://oauth/callback?code=abc',
  ]) assert.throws(() => validateOAuthCallback(invalid));
});

test('key filtering selects only a classified publishable key', () => {
  const selected = selectPublishableKey([
    { name: 'service_role', api_key: 'eyServiceRoleKeyThatMustNeverShip' },
    { type: 'secret', api_key: 'sb_secret_must_never_ship_to_desktop' },
    { type: 'publishable', api_key: 'sb_publishable_safe_data_plane_key' },
    { name: 'unclassified', api_key: 'fallback_is_not_permitted_here' },
  ]);
  assert.equal(selected, 'sb_publishable_safe_data_plane_key');
  assert.throws(() => selectPublishableKey([{ name: 'service_role', api_key: 'long_service_role_key_value' }]));
  assert.throws(() => selectPublishableKey([
    { type: 'publishable', api_key: 'sb_publishable_first_key_value' },
    { type: 'publishable', api_key: 'sb_publishable_second_key_value' },
  ]), /ambiguous/);
  const serviceJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  assert.throws(() => selectPublishableKey([{ name: 'anon', api_key: serviceJwt }]));
});

test('pairing payload validates exact QR v2 fields and five-minute lifetime', () => {
  const now = Date.parse('2026-08-24T00:00:00.000Z');
  const valid = {
    v: 2,
    url: 'https://abcde.supabase.co',
    token: encodePairingClaimToken(
      '018f3f67-89ab-7cde-8f01-23456789abcd',
      'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    ),
    exp: now + 300_000,
  };
  assert.equal(validatePairingQrV2(valid, now).url, 'https://abcde.supabase.co');
  assert.throws(() => validatePairingQrV2({ ...valid, exp: now }, now), /expired/);
  assert.throws(() => validatePairingQrV2({ ...valid, exp: now + 300_001 }, now), /five minutes/);
  assert.throws(() => validatePairingQrV2({ ...valid, service_role: 'leak' }, now), /fields/);
  assert.throws(() => validatePairingQrV2({ ...valid, key: 'sb_publishable_forbidden_in_qr' }, now), /fields/);
  assert.throws(() => validatePairingEnvelope({ ...valid, key: 'sb_publishable_forbidden_in_qr' }, now), /field|필드/);
  assert.deepEqual(validatePairingEnvelope(valid, now), valid);
});

test('cloud rows normalize canonical token, cost and timestamp fields for the renderer', () => {
  assert.deepEqual(normalizeSession({
    id: 'cloud-session', agent_type: 'codex', model_name: 'gpt-5.6', title: 'Cloud',
    status: 'completed', is_interrupted: false,
    started_at: '2026-08-24T01:02:03.000Z', updated_at: '2026-08-24T04:05:06.000Z',
    prompt_tokens: '1200', completion_tokens: 345, total_tokens: 1545,
    estimated_cost_microusd: 1_234_567, is_archived: false,
    metadata: { workspace_label: 'Cloud Mac', account_type: 'work' },
  }), {
    id: 'cloud-session', device_name: 'This device', user_email: 'unknown', account_type: 'work',
    agent_type: 'codex', model_name: 'gpt-5.6', title: 'Cloud', status: 'completed',
    is_interrupted: false, started_at: '2026-08-24T01:02:03.000Z',
    updated_at: '2026-08-24T04:05:06.000Z', total_prompt_tokens: 1200,
    total_completion_tokens: 345, total_tokens: 1545, estimated_cost_usd: 1.234567,
    is_archived: false,
  });

  assert.deepEqual(normalizeStep({
    id: 'cloud-step', session_id: 'cloud-session', step_index: 7,
    source: 'assistant', action_type: 'chat', status: 'completed', is_interrupted: false,
    prompt_tokens: 21, completion_tokens: '34', total_tokens: 55,
    occurred_at: '2026-08-24T07:08:09.000Z',
  }), {
    id: 'cloud-step', session_id: 'cloud-session', device_name: 'This device',
    user_email: 'unknown', account_type: 'personal', step_index: 7, source: 'assistant',
    action_type: 'chat', status: 'completed', is_interrupted: false, prompt_tokens: 21,
    completion_tokens: 34, total_tokens: 55, preview_text: '',
    timestamp: '2026-08-24T07:08:09.000Z',
  });
});

test('schema apply checks the management API HTTP status', async () => {
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(url.pathname);
    if (url.pathname.endsWith('/oauth/token')) {
      return Response.json({ access_token: 'management_access_token_in_memory_only' });
    }
    if (url.pathname === '/v1/projects') {
      return Response.json([{ id: 'project-id', ref: 'abcde', name: 'Explicit project' }]);
    }
    if (url.pathname.endsWith('/database/query')) return new Response(null, { status: 500 });
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  const client = new SupabaseManagementClient({
    clientId: 'client-id',
    authorizationEndpoint: 'https://api.supabase.com/v1/oauth/authorize',
    tokenEndpoint: 'https://api.supabase.com/v1/oauth/token',
    managementApiOrigin: 'https://api.supabase.com',
    allowedOrigins: ['https://api.supabase.com'],
    scopes: ['projects:read'],
  }, fakeFetch);
  const start = client.beginOAuth();
  await client.completeAuthorization(`tokkie://oauth/callback?code=code&state=${start.state}`);
  await assert.rejects(client.applySchema('project-id', 'select 1'), /HTTP 500/);
  assert.ok(calls.includes('/v1/projects/abcde/database/query'));
});

test('management installs only a validated bootstrap digest in the explicitly selected project', async () => {
  const queries: string[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname.endsWith('/oauth/token')) return Response.json({ access_token: 'management_access_token_in_memory_only' });
    if (url.pathname === '/v1/projects') return Response.json([{ id: 'project-id', ref: 'abcde', name: 'Explicit project' }]);
    if (url.pathname.endsWith('/database/query')) {
      queries.push(String(JSON.parse(String(init?.body)).query));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  const client = new SupabaseManagementClient({
    clientId: 'client-id', authorizationEndpoint: 'https://api.supabase.com/v1/oauth/authorize',
    tokenEndpoint: 'https://api.supabase.com/v1/oauth/token', managementApiOrigin: 'https://api.supabase.com',
    allowedOrigins: ['https://api.supabase.com'], scopes: ['projects:read','database:write'],
  }, fakeFetch);
  const start = client.beginOAuth();
  await client.completeAuthorization(`tokkie://oauth/callback?code=code&state=${start.state}`);
  const secret = generateOwnerBootstrapSecret();
  const digest = ownerBootstrapSecretHash(secret);
  await client.installOwnerBootstrap('project-id', digest);
  assert.equal(queries.length, 1);
  assert.match(queries[0], new RegExp(digest));
  assert.equal(queries[0].includes(secret), false);
  await assert.rejects(client.installOwnerBootstrap('project-id', `${digest}' ; select 1; --`));
});

test('outbox rejects nested prompt/token material before making a request', async () => {
  let fetched = false;
  const client = new SupabaseSyncClient({
    projectUrl: 'https://abcde.supabase.co',
    publishableKey: 'sb_publishable_safe_data_plane_key',
    getAccessToken: () => 'signed_in_member_access_token',
    fetchImpl: (async () => { fetched = true; return new Response(null, { status: 201 }); }) as typeof fetch,
  });
  await assert.rejects(client.push([{
    entity: 'sessions', owner_id: 'owner', id: 'id', created_by_member_id: 'member',
    payload_version: 1, payload_hash: 'a'.repeat(64),
    fields: { metadata: { extra: { refresh_token: 'must-not-sync' } } },
  }]), /Forbidden cloud field/);
  assert.equal(fetched, false);
});

const sourceHash = 'b'.repeat(64);
const mappingOwnerId = '018f3f67-89ab-7cde-8f01-23456789abc1';
const mappingMemberId = '018f3f67-89ab-7cde-8f01-23456789abc2';
const provenance = {
  source_id: 'src:v1:codex:hash',
  source_revision: { size_bytes: 123, content_sha256: sourceHash },
  native_id: 'native-id',
  observed_at: '2026-08-24T01:00:00.000Z',
  parser: { name: 'codex', version: '1.0', path: '/must/not/sync' },
  verification: 'verified',
};

test('outbox mapper emits exact session columns and strips nested local/private data', () => {
  const envelope = mapOutboxEntry({
    entity_type: 'session', entity_id: 'session-id', payload_version: 3,
    payload_hash: 'c'.repeat(64),
    payload: {
      operation: 'upsert',
      record: {
        schema_version: 1, id: 'session-id', source_id: 'src:v1:codex:hash',
        native_session_id: 'native-session', agent_type: 'codex', model_name: 'gpt-5',
        title: 'raw user prompt must not sync', status: 'completed', is_interrupted: false,
        started_at: '2026-08-24T00:00:00.000Z', updated_at: '2026-08-24T01:00:00.000Z',
        tokens: { prompt: 11, completion: 7, total: 18 }, estimated_cost_usd: 0.123456,
        cost_estimate: { status: 'estimated', pricing_version: 'prices-v1', input_usd_per_million: 3, output_usd_per_million: 15 },
        is_archived: false, legacy_unverified: false,
        source_locator: '/Users/private/log.jsonl',
        metadata: {
          account_type: 'personal', subagent_count: 2, workspace_label: '/secret/workspace',
          extra: { access_token: 'nested-oauth-secret', raw_prompt: 'private prompt' },
        },
        provenance: { ...provenance, tool_arguments: { password: 'never' } },
      },
    },
  }, { ownerId: mappingOwnerId, memberId: mappingMemberId, mappedAt: '2026-08-24T02:00:00.000Z' });

  assert.equal(envelope.entity, 'sessions');
  assert.deepEqual(envelope.fields, {
    schema_version: 1,
    source_id: 'src:v1:codex:hash',
    native_session_id: 'native-session',
    agent_type: 'codex',
    model_name: 'gpt-5',
    title: 'Untitled Session',
    status: 'completed',
    is_interrupted: false,
    started_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T01:00:00.000Z',
    prompt_tokens: 11,
    completion_tokens: 7,
    total_tokens: 18,
    estimated_cost_microusd: 123456,
    cost_estimate: { status: 'estimated', pricing_version: 'prices-v1', input_usd_per_million: 3, output_usd_per_million: 15 },
    is_archived: false,
    legacy_unverified: false,
    metadata: { account_type: 'personal', subagent_count: 2 },
    provenance: {
      source_id: 'src:v1:codex:hash',
      source_revision: { size_bytes: 123, content_sha256: sourceHash },
      native_id: 'native-id', observed_at: '2026-08-24T01:00:00.000Z',
      parser: { name: 'codex', version: '1.0' }, verification: 'verified',
    },
    cloud_updated_at: '2026-08-24T02:00:00.000Z',
  });
  const serialized = JSON.stringify(envelope);
  for (const forbidden of ['raw user prompt','nested-oauth-secret','private prompt','/Users/private','/secret/workspace','password']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.match(envelope.payload_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(envelope.payload_hash, 'c'.repeat(64));
});

test('outbox mapper preserves unknown cost as null with a sanitized estimate status', () => {
  const envelope = mapOutboxEntry({
    entity_type: 'session', entity_id: 'unknown-cost', payload_version: 1, payload_hash: '7'.repeat(64),
    payload: { operation: 'upsert', record: {
      schema_version: 1, id: 'unknown-cost', source_id: 'src:v1:codex:unknown', native_session_id: 'native-unknown',
      agent_type: 'codex', model_name: 'future-model', title: 'private title', status: 'completed', is_interrupted: false,
      started_at: '2026-08-24T00:00:00.000Z', updated_at: '2026-08-24T01:00:00.000Z',
      tokens: { prompt: 1, completion: 2, total: 3 }, estimated_cost_usd: null,
      cost_estimate: { status: 'unavailable', pricing_version: 'prices-v1', reason: 'unknown_model' },
      is_archived: false, legacy_unverified: false, metadata: {}, provenance,
    } },
  }, { ownerId: mappingOwnerId, memberId: mappingMemberId, mappedAt: '2026-08-24T02:00:00.000Z' });
  assert.equal(envelope.fields.estimated_cost_microusd, null);
  assert.deepEqual(envelope.fields.cost_estimate, {
    status: 'unavailable', pricing_version: 'prices-v1', reason: 'unknown_model',
  });
  assert.throws(() => mapOutboxEntry({
    entity_type: 'session', entity_id: 'unknown-cost', payload_version: 2, payload_hash: '8'.repeat(64),
    payload: { operation: 'upsert', record: {
      schema_version: 1, id: 'unknown-cost', source_id: 'src:v1:codex:unknown', native_session_id: 'native-unknown',
      agent_type: 'codex', model_name: 'future-model', title: 'private title', status: 'completed', is_interrupted: false,
      started_at: '2026-08-24T00:00:00.000Z', updated_at: '2026-08-24T01:00:00.000Z',
      tokens: { prompt: 1, completion: 2, total: 3 }, estimated_cost_usd: null,
      cost_estimate: { status: 'estimated', pricing_version: 'prices-v1' },
      is_archived: false, legacy_unverified: false, metadata: {}, provenance,
    } },
  }, { ownerId: mappingOwnerId, memberId: mappingMemberId }), /missing cost requires unavailable/);
});

test('outbox mapper emits step schema columns without preview/tool args and maps delete to tombstone', () => {
  const step = mapOutboxEntry({
    entity_type: 'step', entity_id: 'step-id', payload_version: 1, payload_hash: 'd'.repeat(64),
    payload: { operation: 'upsert', record: {
      schema_version: 1, id: 'step-id', session_id: 'session-id', source_id: 'src:v1:codex:hash',
      native_step_id: 'native-step', step_index: 4, source: 'tool', action_type: 'shell',
      status: 'completed', is_interrupted: false, tokens: { prompt: 3, completion: 2, total: 5 },
      preview_text: 'raw prompt preview', timestamp: '2026-08-24T03:00:00.000Z',
      legacy_unverified: false,
      metadata: { tools: ['shell --password secret'], tool_count: 1, subagent: { depth: 2, path: '/private' }, extra: { tool_args: 'secret' } },
      provenance,
    } },
  }, { ownerId: mappingOwnerId, memberId: mappingMemberId, mappedAt: '2026-08-24T04:00:00.000Z' });
  assert.equal(step.entity, 'steps');
  assert.equal(step.fields.occurred_at, '2026-08-24T03:00:00.000Z');
  assert.equal(step.fields.prompt_tokens, 3);
  assert.deepEqual(step.fields.metadata, { tool_count: 1, subagent: { depth: 2 } });
  assert.equal(JSON.stringify(step).includes('raw prompt preview'), false);
  assert.equal(JSON.stringify(step).includes('--password'), false);

  const tombstone = mapOutboxEntry({
    entity_type: 'step', entity_id: 'step-id', payload_version: 2,
    payload_hash: 'e'.repeat(64), payload: { operation: 'delete', id: 'step-id' },
  }, { ownerId: mappingOwnerId, memberId: mappingMemberId, mappedAt: '2026-08-24T05:00:00.000Z' });
  assert.equal(tombstone.deleted_at, '2026-08-24T05:00:00.000Z');
  assert.deepEqual(tombstone.fields, { cloud_updated_at: '2026-08-24T05:00:00.000Z' });
  const retriedTombstone = mapOutboxEntry({
    entity_type: 'step', entity_id: 'step-id', payload_version: 2,
    payload_hash: 'e'.repeat(64), payload: { operation: 'delete', id: 'step-id' },
  }, { ownerId: mappingOwnerId, memberId: mappingMemberId, mappedAt: '2026-08-24T05:01:00.000Z' });
  assert.equal(retriedTombstone.payload_hash, tombstone.payload_hash);
});

test('sync client routes delete-first through guarded RPC for a durable tombstone', async () => {
  let request: { url: URL; init?: RequestInit } | undefined;
  const client = new SupabaseSyncClient({
    projectUrl: 'https://abcde.supabase.co',
    publishableKey: 'sb_publishable_safe_data_plane_key',
    getAccessToken: () => 'signed-in-access-token',
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: new URL(input instanceof Request ? input.url : input.toString()), init };
      return Response.json('applied');
    }) as typeof fetch,
  });
  await client.push([{
    entity: 'steps', owner_id: mappingOwnerId, id: 'step-id',
    created_by_member_id: mappingMemberId, payload_version: 2,
    payload_hash: 'f'.repeat(64),
    fields: { cloud_updated_at: '2026-08-24T05:00:00.000Z' },
    deleted_at: '2026-08-24T05:00:00.000Z',
  }]);
  assert.equal(request?.init?.method, 'POST');
  assert.equal(request?.url.pathname, '/rest/v1/rpc/apply_cloud_sync');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    p_entity: 'steps', p_owner_id: mappingOwnerId, p_id: 'step-id',
    p_created_by_member_id: mappingMemberId, p_payload_version: 2,
    p_payload_hash: 'f'.repeat(64),
    p_fields: {
      owner_id: mappingOwnerId, id: 'step-id', created_by_member_id: mappingMemberId,
      payload_version: 2, payload_hash: 'f'.repeat(64),
      deleted_at: '2026-08-24T05:00:00.000Z', cloud_updated_at: '2026-08-24T05:00:00.000Z',
    },
    p_deleted_at: '2026-08-24T05:00:00.000Z',
  });
});

test('sync client accepts applied/idempotent/stale only and preserves the core monotonic version', async () => {
  const bodies: unknown[] = [];
  const results = ['applied', 'idempotent', 'stale', 'unexpected'];
  const client = new SupabaseSyncClient({
    projectUrl: 'https://abcde.supabase.co', publishableKey: 'sb_publishable_safe_data_plane_key',
    getAccessToken: () => 'signed-in-access-token',
    fetchImpl: (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json(results.shift());
    }) as typeof fetch,
  });
  const envelope = {
    entity: 'sessions' as const, owner_id: mappingOwnerId, id: 'session-id',
    created_by_member_id: mappingMemberId, payload_version: 41,
    payload_hash: '9'.repeat(64), fields: { cloud_updated_at: '2026-08-24T05:00:00.000Z' },
  };
  await client.push([envelope]);
  await client.push([envelope]);
  await client.push([envelope]);
  await assert.rejects(client.push([envelope]), /invalid acknowledgement/);
  assert.ok(bodies.every((body) => (body as { p_payload_version: number }).p_payload_version === 41));
  assert.deepEqual(bodies[0], bodies[1]);
});

function authenticatedJwt(): string {
  return `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({
    role: 'authenticated', sub: '018f3f67-89ab-7cde-8f01-23456789abcd',
  })).toString('base64url')}.signature`;
}

test('pairing administration creates replay-compatible QR and issues pending approve/revoke requests', async () => {
  const owner = '018f3f67-89ab-7cde-8f01-23456789abce';
  const member = '018f3f67-89ab-7cde-8f01-23456789abcf';
  const approvedMember = '018f3f67-89ab-7cde-8f01-23456789abd0';
  const pairing = '018f3f67-89ab-7cde-8f01-23456789abcd';
  const now = Date.parse('2026-08-24T00:00:00.000Z');
  const requests: Array<{ path: string; method: string; body?: unknown; query: string; authorization: string | null; apikey: string | null }> = [];
  let tokenReads = 0;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    requests.push({
      path: url.pathname, method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      query: url.search,
      authorization: headers.get('authorization'),
      apikey: headers.get('apikey'),
    });
    if (url.pathname.endsWith('/create_pairing_token')) return Response.json([{
      pairing_id: pairing,
      one_time_secret: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
      expires_at: new Date(now + 300_000).toISOString(),
    }]);
    if (url.pathname === '/rest/v1/members') return Response.json([
      { id: member, owner_id: owner, role: 'viewer', display_name: 'Phone viewer',
        created_at: '2026-08-24T00:01:00.000Z', approved_at: null },
      { id: approvedMember, owner_id: owner, role: 'device', display_name: 'Collector Mac',
        created_at: '2026-08-24T00:02:00.000Z', approved_at: '2026-08-24T00:03:00.000Z' },
    ]);
    if (url.pathname.endsWith('/approve_member') || url.pathname.endsWith('/revoke_member')) return Response.json(true);
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  const service = new PairingAdministrationService({
    projectUrl: 'https://abcde.supabase.co',
    publishableKey: 'sb_publishable_safe_data_plane_key',
    getAccessToken: () => { tokenReads += 1; return authenticatedJwt(); },
    getOwnerId: () => owner,
    fetchImpl: fakeFetch,
  });

  const qr = await service.createPairingToken('viewer', 'Phone viewer', now);
  assert.equal(Object.hasOwn(qr, 'key'), false);
  assert.deepEqual(decodePairingClaimToken(qr.token), {
    pairingId: pairing, oneTimeSecret: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
  });
  // Decoding again yields the same DB claim inputs; claim_pairing_token enforces replay atomically.
  assert.deepEqual(decodePairingClaimToken(qr.token), decodePairingClaimToken(qr.token));
  assert.equal(qr.exp, now + 300_000);
  assert.deepEqual(await service.listPendingMembers(), [{
    id: member, ownerId: owner, role: 'viewer', displayName: 'Phone viewer',
    createdAt: '2026-08-24T00:01:00.000Z',
  }]);
  assert.deepEqual(await service.listMembers(), [
    { id: member, ownerId: owner, role: 'viewer', displayName: 'Phone viewer', createdAt: '2026-08-24T00:01:00.000Z' },
    { id: approvedMember, ownerId: owner, role: 'device', displayName: 'Collector Mac',
      createdAt: '2026-08-24T00:02:00.000Z', approvedAt: '2026-08-24T00:03:00.000Z' },
  ]);
  await service.approveMember(member);
  await service.revokeMember(member);
  assert.equal(tokenReads, 5);
  assert.deepEqual(requests.map((request) => request.path), [
    '/rest/v1/rpc/create_pairing_token', '/rest/v1/members', '/rest/v1/members',
    '/rest/v1/rpc/approve_member', '/rest/v1/rpc/revoke_member',
  ]);
  assert.deepEqual(requests[0].body, {
    p_owner_id: owner, p_requested_role: 'viewer', p_display_name: 'Phone viewer',
  });
  assert.doesNotMatch(requests[1].query, /approved_at=is.null/);
  assert.deepEqual(requests[3].body, { p_owner_id: owner, p_member_id: member });
  assert.deepEqual(requests[4].body, { p_owner_id: owner, p_member_id: member });
  assert.ok(requests.every((request) => request.authorization?.startsWith('Bearer ')));
  assert.ok(requests.every((request) => request.apikey === 'sb_publishable_safe_data_plane_key'));
});

test('pairing administration is explicitly unavailable without owner bootstrap', async () => {
  const service = new PairingAdministrationService({
    projectUrl: 'https://abcde.supabase.co', publishableKey: 'sb_publishable_safe_data_plane_key',
    getAccessToken: authenticatedJwt, getOwnerId: () => undefined,
    fetchImpl: (async () => { throw new Error('must not fetch'); }) as typeof fetch,
  });
  await assert.rejects(service.listPendingMembers(), (error: unknown) =>
    error instanceof CloudDataPlaneUnavailableError && error.code === 'UNAVAILABLE');
});
