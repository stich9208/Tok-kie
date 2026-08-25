import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CloudController } from '../app/cloud-controller';
import type { CollectorCoreFacade } from '../core/facade';
import type { SafeStorageLike } from './storage';

const ownerId = '018f3f67-89ab-7cde-8f01-23456789abc1';
const memberId = '018f3f67-89ab-7cde-8f01-23456789abc2';
const projectUrl = 'https://abcde.supabase.co';
const publishableKey = 'sb_publishable_safe_data_plane_key';
const setupId = '123e4567-e89b-42d3-a456-426614174000';
const schema = 'begin;\nselect 1;\ncommit;';
const dataAccessToken = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({
  role: 'authenticated', sub: '018f3f67-89ab-7cde-8f01-23456789abcd', is_anonymous: true,
})).toString('base64url')}.signature`;

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').slice('encrypted:'.length),
};

const collector = {
  outboxDue: async () => [],
  acknowledgeOutbox: async () => true,
  failOutbox: async () => undefined,
} as unknown as CollectorCoreFacade;

async function fixture(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const schemaPath = join(directory, 'schema.sql');
  await writeFile(schemaPath, schema, 'utf8');
  return {
    directory,
    schemaPath,
    configPath: join(directory, 'config.json'),
    credentialPath: join(directory, 'credential.json'),
  };
}

test('manual setup returns exact checked-in schema plus digest SQL and never the raw secret', async () => {
  const files = await fixture('tokkie-manual-digest-');
  const secretBuffer = Buffer.alloc(32, 0x2a);
  const expectedRawSecret = Buffer.from(secretBuffer).toString('base64url');
  const digest = createHash('sha256').update(expectedRawSecret, 'utf8').digest('hex');
  const controller = new CloudController({
    ...files, safeStorage, collector,
    randomBytesImpl: () => secretBuffer,
    randomUuidImpl: () => setupId,
    now: () => Date.parse('2026-08-24T00:00:00.000Z'),
    fetchImpl: (async () => { throw new Error('must not fetch before confirmation'); }) as typeof fetch,
  });
  try {
    const firstAttempt = controller.beginManualSetup(projectUrl, publishableKey);
    await assert.rejects(controller.beginManualSetup(projectUrl, publishableKey), /already pending/);
    const result = await firstAttempt;
    assert.deepEqual(result, {
      setup_id: setupId,
      project_ref: 'abcde',
      expires_at: '2026-08-24T00:10:00.000Z',
      setup_sql: `${schema}\n\nselect public.install_owner_bootstrap(decode('${digest}', 'hex'));\n`,
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(expectedRawSecret), false);
    assert.equal(serialized.includes(publishableKey), false);
    assert.equal(serialized.includes("decode('" + digest + "', 'hex')"), true);
    await assert.rejects(controller.beginManualSetup(projectUrl, publishableKey), /already pending/);
    await assert.rejects(readFile(files.configPath, 'utf8'), /ENOENT/);
  } finally {
    await controller.close();
    assert.equal(secretBuffer.every((byte) => byte === 0), true);
    await rm(files.directory, { recursive: true, force: true });
  }
});

test('manual confirmation is project-bound, one-shot, and destroys the secret on mismatch and expiry', async () => {
  const mismatchFiles = await fixture('tokkie-manual-mismatch-');
  const mismatchSecret = Buffer.alloc(32, 0x19);
  const mismatch = new CloudController({
    ...mismatchFiles, safeStorage, collector,
    randomBytesImpl: () => mismatchSecret, randomUuidImpl: () => setupId,
    fetchImpl: (async () => { throw new Error('must not fetch on mismatch'); }) as typeof fetch,
  });
  try {
    await mismatch.beginManualSetup(projectUrl, publishableKey);
    await assert.rejects(
      mismatch.confirmManualSetup(setupId, 'https://other-project.supabase.co'),
      /does not match the pending project/,
    );
    assert.equal(mismatchSecret.every((byte) => byte === 0), true);
    await assert.rejects(mismatch.confirmManualSetup(setupId, projectUrl), /already consumed/);
  } finally {
    await mismatch.close();
    await rm(mismatchFiles.directory, { recursive: true, force: true });
  }

  const expiryFiles = await fixture('tokkie-manual-expiry-');
  const expirySecret = Buffer.alloc(32, 0x37);
  let now = 1_000;
  const expired = new CloudController({
    ...expiryFiles, safeStorage, collector,
    randomBytesImpl: () => expirySecret, randomUuidImpl: () => setupId,
    now: () => now, manualSetupTtlMs: 50,
    fetchImpl: (async () => { throw new Error('must not fetch after expiry'); }) as typeof fetch,
  });
  try {
    await expired.beginManualSetup(projectUrl, publishableKey);
    now = 1_051;
    await assert.rejects(expired.confirmManualSetup(setupId, projectUrl), /expired/);
    assert.equal(expirySecret.every((byte) => byte === 0), true);
  } finally {
    await expired.close();
    await rm(expiryFiles.directory, { recursive: true, force: true });
  }
});

test('confirmed manual bootstrap stores only identity and encrypted refresh session, then refreshes after restart', async () => {
  const files = await fixture('tokkie-cloud-restart-');
  const rawBytes = Buffer.alloc(32, 0x51);
  const expectedRawSecret = Buffer.from(rawBytes).toString('base64url');
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const firstFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ path: url.pathname + url.search, body });
    if (url.pathname === '/auth/v1/signup') {
      return Response.json({ access_token: dataAccessToken, refresh_token: 'refresh-secret', expires_in: 3600 });
    }
    if (url.pathname.endsWith('/claim_owner_bootstrap')) {
      assert.deepEqual(body, { p_one_time_secret: expectedRawSecret, p_display_name: 'Tok-kie Owner' });
      return Response.json([{ owner_id: ownerId, member_id: memberId }]);
    }
    if (url.pathname === '/rest/v1/members') return Response.json([{
      id: '018f3f67-89ab-7cde-8f01-23456789abc3', owner_id: ownerId, role: 'device',
      display_name: 'Collector', created_at: '2026-08-24T00:00:00.000Z',
      approved_at: '2026-08-24T00:01:00.000Z', auth_user_id: 'must-never-reach-renderer',
    }]);
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  const controller = new CloudController({
    ...files, safeStorage, collector, fetchImpl: firstFetch,
    randomBytesImpl: () => rawBytes, randomUuidImpl: () => setupId,
  });
  try {
    const prepared = await controller.beginManualSetup(projectUrl, publishableKey);
    const settings = await controller.confirmManualSetup(prepared.setup_id, projectUrl);
    assert.deepEqual(settings, {
      configured: true, project_url: projectUrl, project_ref: 'abcde',
      owner_id: ownerId, member_id: memberId, auth_mode: 'manual_publishable_key',
    });
    assert.equal(rawBytes.every((byte) => byte === 0), true);
    await assert.rejects(controller.confirmManualSetup(prepared.setup_id, projectUrl), /already consumed/);
    assert.equal(calls.filter((call) => call.path.endsWith('/claim_owner_bootstrap')).length, 1);
    assert.deepEqual(await controller.listMembers(), [{
      id: '018f3f67-89ab-7cde-8f01-23456789abc3', role: 'device', display_name: 'Collector',
      created_at: '2026-08-24T00:00:00.000Z', approved_at: '2026-08-24T00:01:00.000Z',
    }]);
    const config = await readFile(files.configPath, 'utf8');
    assert.equal(config.includes(expectedRawSecret), false);
    assert.equal(config.includes('refresh-secret'), false);
    const credential = await readFile(files.credentialPath, 'utf8');
    assert.equal(credential.includes(expectedRawSecret), false);
    assert.equal(credential.includes('refresh-secret'), false);
  } finally {
    await controller.close();
  }

  let refreshBody: Record<string, unknown> | undefined;
  const restarted = new CloudController({
    ...files, safeStorage, collector,
    fetchImpl: (async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        refreshBody = JSON.parse(String(init?.body));
        return Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
      }
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch,
  });
  try {
    await restarted.start();
    assert.deepEqual(refreshBody, { refresh_token: 'refresh-secret' });
    assert.equal(restarted.settings().configured, true);
  } finally {
    await restarted.close();
    await rm(files.directory, { recursive: true, force: true });
  }
});

test('a failed claim destroys pending proof and does not persist partial configuration', async () => {
  const files = await fixture('tokkie-manual-failure-');
  const secret = Buffer.alloc(32, 0x63);
  const controller = new CloudController({
    ...files, safeStorage, collector,
    randomBytesImpl: () => secret, randomUuidImpl: () => setupId,
    fetchImpl: (async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === '/auth/v1/signup') {
        return Response.json({ access_token: dataAccessToken, refresh_token: 'must-not-persist', expires_in: 3600 });
      }
      if (url.pathname.endsWith('/claim_owner_bootstrap')) return new Response(null, { status: 403 });
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch,
  });
  try {
    await controller.beginManualSetup(projectUrl, publishableKey);
    await assert.rejects(controller.confirmManualSetup(setupId, projectUrl), /HTTP 403/);
    assert.equal(secret.every((byte) => byte === 0), true);
    assert.deepEqual(controller.settings(), { configured: false });
    await assert.rejects(controller.confirmManualSetup(setupId, projectUrl), /already consumed/);
    await assert.rejects(readFile(files.configPath, 'utf8'), /ENOENT/);
    await assert.rejects(readFile(files.credentialPath, 'utf8'), /ENOENT/);
  } finally {
    await controller.close();
    await rm(files.directory, { recursive: true, force: true });
  }
});
