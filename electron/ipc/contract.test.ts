import assert from 'node:assert/strict';
import test from 'node:test';
import { IPC_CHANNELS } from '../../shared/ipc';
import { validateIpcRequest } from '../../shared/validation';

const MEMBER_ID = '123e4567-e89b-42d3-a456-426614174000';
const serviceRoleKey = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`;
const legacyAnonKey = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"anon"}').toString('base64url')}.signature`;

test('cloud IPC contract validates every renderer request at the shared boundary', () => {
  assert.equal(validateIpcRequest(IPC_CHANNELS.listOAuthProjects, {}).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.listOAuthProjects, { implicit: 'first' }).ok, false);
  assert.equal(validateIpcRequest(IPC_CHANNELS.selectOAuthProject, {}).ok, false);
  assert.equal(validateIpcRequest(IPC_CHANNELS.selectOAuthProject, { project_ref: 'project-ref-123' }).ok, true);

  assert.equal(validateIpcRequest(IPC_CHANNELS.beginManualCloudSetup, {
    project_url: 'https://abcde.supabase.co', publishable_key: 'sb_publishable_safe_data_plane_key',
  }).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.beginManualCloudSetup, {
    project_url: 'https://abcde.supabase.co', publishable_key: 'sb_publishable_safe_data_plane_key',
    bootstrap_secret: 'forbidden',
  }).ok, false);
  assert.equal(validateIpcRequest(IPC_CHANNELS.beginManualCloudSetup, {
    project_url: 'https://evil.example.com', publishable_key: 'sb_publishable_safe_data_plane_key',
  }).ok, false);
  assert.equal(validateIpcRequest(IPC_CHANNELS.beginManualCloudSetup, {
    project_url: 'https://abcde.supabase.co', publishable_key: legacyAnonKey,
  }).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.beginManualCloudSetup, {
    project_url: 'https://abcde.supabase.co', publishable_key: serviceRoleKey,
  }).ok, false);
  assert.equal(validateIpcRequest(IPC_CHANNELS.beginManualCloudSetup, {
    project_url: 'https://abcde.supabase.co', publishable_key: 'sbp_personal_access_token_forbidden',
  }).ok, false);
  assert.equal(validateIpcRequest(IPC_CHANNELS.confirmManualCloudSetup, {
    setup_id: MEMBER_ID, project_url: 'https://abcde.supabase.co',
  }).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.confirmManualCloudSetup, {
    setup_id: MEMBER_ID, project_url: 'https://abcde.supabase.co', one_time_secret: 'forbidden',
  }).ok, false);

  assert.equal(validateIpcRequest(IPC_CHANNELS.createPairing, {}).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.createPairing, { device_label: 'Phone' }).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.createPairing, { device_label: '' }).ok, false);
  assert.equal(validateIpcRequest(IPC_CHANNELS.createPairing, { one_time_secret: 'forbidden' }).ok, false);

  assert.equal(validateIpcRequest(IPC_CHANNELS.listPairingMembers, {}).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.approvePairingMember, { member_id: MEMBER_ID }).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.revokePairingMember, { member_id: MEMBER_ID }).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.approvePairingMember, { member_id: 'not-a-uuid' }).ok, false);

  assert.equal(validateIpcRequest(IPC_CHANNELS.listLegacyMappings, {}).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.mapLegacyPayload, {
    payload_hash: 'a'.repeat(64),
    verified_source_id: 'src:v1:claude_code:verified',
  }).ok, true);
  assert.equal(validateIpcRequest(IPC_CHANNELS.mapLegacyPayload, {
    payload_hash: 'raw-payload-is-forbidden',
    verified_source_id: 'src:v1:claude_code:verified',
  }).ok, false);
});

test('renderer contract has no OAuth callback or raw cloud credential channel', () => {
  const channels = Object.values(IPC_CHANNELS) as readonly string[];
  assert.equal(channels.some((channel) => channel.includes('complete-oauth')), false);
  assert.equal(channels.some((channel) => channel.includes('update-settings')), false);
  assert.equal(channels.some((channel) => /secret|service-role|personal-access|client-secret/i.test(channel)), false);
});
