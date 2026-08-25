import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('checked-in Supabase schema retains bootstrap, RLS, pairing and guarded-sync security contracts', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/schema.sql'), 'utf8');
  for (const required of [
    'alter table public.owner_bootstrap_tokens force row level security',
    'revoke all on function public.install_owner_bootstrap(bytea) from public, anon, authenticated',
    'grant execute on function public.claim_owner_bootstrap(text,text) to authenticated',
    "failed_attempts=least(failed_attempts+1,5)",
    "expires_at <= now()",
    "create table if not exists public.sync_tombstones",
    "raise exception 'sync version/hash conflict'",
    'pg_advisory_xact_lock(pg_catalog.hashtextextended(',
    "return 'idempotent'",
    "return 'stale'",
    'grant select on public.sessions, public.steps, public.sync_tombstones to authenticated',
    'grant execute on function public.apply_cloud_sync',
    'estimated_cost_microusd bigint check (estimated_cost_microusd is null',
    "cost_estimate ->> 'status' = 'unavailable'",
  ]) assert.ok(sql.includes(required), `schema contract omitted: ${required}`);

  for (const table of [
    'owners', 'members', 'devices', 'pairing_tokens', 'owner_bootstrap_tokens',
    'sessions', 'steps', 'sync_tombstones',
  ]) {
    assert.ok(
      sql.includes(`create table if not exists public.${table}`),
      `schema retry would recreate table: ${table}`,
    );
  }
  for (const policy of [
    'owners_read', 'members_read_self_or_owner', 'devices_read_self_or_owner',
    'sessions_read', 'steps_read', 'tombstones_read',
  ]) {
    assert.ok(
      sql.includes(`drop policy if exists ${policy}`),
      `schema retry would collide with policy: ${policy}`,
    );
  }
  assert.equal(/^create function public\./m.test(sql), false, 'schema functions must be replaceable on retry');

  assert.equal(/grant\s+(?:select,\s*)?(?:insert|update|delete)[^;]*public\.(?:sessions|steps)/i.test(sql), false);
  assert.equal(/grant execute on function public\.install_owner_bootstrap[^;]*authenticated/i.test(sql), false);
  assert.equal(/grant execute on function public\.create_owner/i.test(sql), false);
});

test('real PostgreSQL security harness retains the complete identity matrix', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/security-test.sql'), 'utf8');

  for (const identity of [
    'owner1_user',
    'owner2_user',
    'viewer_user',
    'device_user',
  ]) assert.ok(sql.includes(identity), `security harness omitted identity: ${identity}`);

  for (const assertion of [
    'owner direct DML must be forbidden',
    'other owner must not write across tenants',
    'approved viewer guarded write must be denied within tenant',
    'approved viewer cross-tenant write must be denied',
    'revoked member guarded write must be denied within former tenant',
    'revoked member cross-tenant write must be denied',
    'approved device cross-tenant write must be denied',
    'null authenticated identity must read no tenant data',
    'anonymous role table read must be denied',
    'delete-first must persist and reject stale resurrection',
    'v2 retry must be idempotent and stale v1 ignored',
  ]) assert.ok(sql.includes(assertion), `security harness omitted assertion: ${assertion}`);

  assert.match(sql, /begin;[\s\S]*rollback;\s*$/);
  assert.match(sql, /create function test\.expect_error\(/);
  assert.match(sql, /permission denied for table sessions/);
  assert.match(sql, /writer membership required/);
});

test('web mobile gateway keeps tombstones hidden and persists revocable auth sessions', async () => {
  const source = await readFile(resolve(process.cwd(), 'dashboard/lib/gateway/web.ts'), 'utf8');
  const modal = await readFile(resolve(process.cwd(), 'dashboard/components/MobilePairingModal.tsx'), 'utf8');
  assert.equal((source.match(/\.is\('deleted_at', null\)/g) ?? []).length, 2);
  assert.match(source, /persistSession:\s*true/);
  assert.match(source, /autoRefreshToken:\s*true/);
  assert.match(source, /pairing\.url\s*!==\s*url/);
  assert.match(source, /select\('id,approved_at,revoked_at'\)/);
  assert.match(source, /clearPairingHash\(window\.location\)/);
  assert.match(modal, /currentValue === copiedValue/);
  assert.match(modal, /navigator\.clipboard\.writeText\(''\)/);
});
