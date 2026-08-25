\set ON_ERROR_STOP on
\echo 'Preparing disposable Supabase-compatible PostgreSQL roles/auth shim'

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create schema if not exists extensions;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
-- Supabase grants its API roles access to these auth helpers. The vanilla
-- postgres service used by CI must mirror those grants explicitly.
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated;

\ir schema.sql
\echo 'Reapplying schema to prove management-OAuth retry safety'
\ir schema.sql

begin;
create schema test;
create function test.ok(p_value boolean,p_message text) returns void language plpgsql as $$
begin if not coalesce(p_value,false) then raise exception 'SECURITY TEST FAILED: %',p_message; end if; end $$;
create function test.expect_error(p_sql text,p_expected text,p_message text) returns void
language plpgsql as $$
declare v_error text;
begin
  begin execute p_sql; exception when others then v_error := sqlerrm; end;
  if v_error is null then
    raise exception 'SECURITY TEST FAILED: % (statement unexpectedly succeeded)',p_message;
  end if;
  if position(p_expected in v_error) = 0 then
    raise exception 'SECURITY TEST FAILED: % (expected error containing %, got %)',
      p_message,p_expected,v_error;
  end if;
end $$;
create function test.session_payload(p_source text,p_native text,p_title text) returns jsonb
language sql immutable as $$ select jsonb_build_object(
  'schema_version',1,'source_id',p_source,'native_session_id',p_native,'agent_type','codex',
  'model_name','gpt','title',p_title,'status','completed','is_interrupted',false,
  'started_at','2026-08-24T00:00:00Z','updated_at','2026-08-24T00:00:00Z',
  'prompt_tokens',1,'completion_tokens',1,'total_tokens',2,'estimated_cost_microusd',1,
  'cost_estimate',jsonb_build_object('status','estimated','pricing_version','test-v1'),
  'is_archived',false,'legacy_unverified',false,'metadata','{}'::jsonb,'provenance','{}'::jsonb
) $$;
grant usage on schema test to anon,authenticated;
grant execute on function test.expect_error(text,text,text) to anon,authenticated;
grant execute on function test.session_payload(text,text,text) to authenticated;

\set owner1_user '10000000-0000-4000-8000-000000000001'
\set owner2_user '20000000-0000-4000-8000-000000000001'
\set viewer_user '30000000-0000-4000-8000-000000000001'
\set device_user '40000000-0000-4000-8000-000000000001'
\set expired_user '50000000-0000-4000-8000-000000000001'
\set failed_user '60000000-0000-4000-8000-000000000001'
insert into auth.users(id) values
  (:'owner1_user'),(:'owner2_user'),(:'viewer_user'),(:'device_user'),(:'expired_user'),(:'failed_user');

-- Management installs only a digest; anonymous data-plane user proves raw secret.
select public.install_owner_bootstrap(extensions.digest(convert_to('owner-secret-00000000000000000000000000000001','UTF8'),'sha256'));
select set_config('request.jwt.claim.sub',:'owner1_user',false),
       set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":true}',false);
set role authenticated;
select * from public.claim_owner_bootstrap('owner-secret-00000000000000000000000000000001','Owner One') \gset o1_
reset role;
select test.ok(:'o1_owner_id' <> '' and :'o1_member_id' <> '','owner bootstrap must return identity');
set role authenticated;
select count(*) as bootstrap_replay_count from public.claim_owner_bootstrap(
  'owner-secret-00000000000000000000000000000001','Replay') \gset
reset role;
select test.ok(:bootstrap_replay_count::int=0,'owner bootstrap must be single-use');

select public.install_owner_bootstrap(extensions.digest(convert_to('owner-secret-00000000000000000000000000000002','UTF8'),'sha256'));
select set_config('request.jwt.claim.sub',:'owner2_user',false),
       set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":true}',false);
set role authenticated;
select * from public.claim_owner_bootstrap('owner-secret-00000000000000000000000000000002','Owner Two') \gset o2_
reset role;

-- Owner writes through guarded sync. Direct DML is privilege-revoked.
select set_config('request.jwt.claim.sub',:'owner1_user',false),
       set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":true}',false);
set role authenticated;
select public.apply_cloud_sync('sessions',:'o1_owner_id','session-1',:'o1_member_id',2,
  repeat('a',64),jsonb_build_object(
    'schema_version',1,'source_id','source-1','native_session_id','native-1','agent_type','codex',
    'model_name','gpt','title','Untitled Session','status','completed','is_interrupted',false,
    'started_at','2026-08-24T00:00:00Z','updated_at','2026-08-24T00:00:00Z',
    'prompt_tokens',1,'completion_tokens',1,'total_tokens',2,'estimated_cost_microusd',1,
    'cost_estimate',jsonb_build_object('status','estimated','pricing_version','test-v1'),
    'is_archived',false,'legacy_unverified',false,'metadata','{}'::jsonb,'provenance','{}'::jsonb),null) as sync_status \gset
select public.apply_cloud_sync('sessions',:'o1_owner_id','session-1',:'o1_member_id',2,
  repeat('a',64),'{}'::jsonb,null) as retry_status \gset
select public.apply_cloud_sync('sessions',:'o1_owner_id','session-1',:'o1_member_id',1,
  repeat('9',64),'{}'::jsonb,null) as old_status \gset
reset role;
select test.ok(:'sync_status'='applied' and :'retry_status'='idempotent' and :'old_status'='stale',
  'v2 retry must be idempotent and stale v1 ignored');
select set_config('tokkie.test.owner1',:'o1_owner_id',false),
       set_config('tokkie.test.member1',:'o1_member_id',false);
do $$ begin
  perform public.apply_cloud_sync('sessions',current_setting('tokkie.test.owner1')::uuid,'session-1',
    current_setting('tokkie.test.member1')::uuid,2,repeat('8',64),'{}'::jsonb,null);
  raise exception 'equal-version hash conflict was accepted';
exception when raise_exception then
  if sqlerrm <> 'sync version/hash conflict' then raise; end if;
end $$;

-- The second owner has a positive own-tenant path and no access to owner one.
select set_config('request.jwt.claim.sub',:'owner2_user',false),
       set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":true}',false);
set role authenticated;
select public.apply_cloud_sync('sessions',:'o2_owner_id','owner2-session',:'o2_member_id',1,
  repeat('2',64),test.session_payload('source-owner2','native-owner2','Owner Two Session'),null)
  as owner2_sync \gset
select count(*) as owner2_own_reads from public.sessions where owner_id=:'o2_owner_id' \gset
select count(*) as owner2_cross_reads from public.sessions where owner_id=:'o1_owner_id' \gset
select test.expect_error(
  format($q$select public.apply_cloud_sync('sessions',%L::uuid,'owner2-cross-write',%L::uuid,
    1,repeat('2',64),'{}'::jsonb,now())$q$,:'o1_owner_id',:'o2_member_id'),
  'writer membership required','other owner must not write across tenants');
select test.expect_error(
  format($q$update public.sessions set title='direct-owner-write' where owner_id=%L::uuid$q$,:'o2_owner_id'),
  'permission denied for table sessions','owner direct DML must be forbidden');
reset role;
select test.ok(:'owner2_sync'='applied' and :owner2_own_reads::int=1 and :owner2_cross_reads::int=0,
  'other owner must write/read own tenant through RPC and see no owner-one rows');

-- Delete-before-first-upsert is durable; stale resurrection is ignored.
select set_config('request.jwt.claim.sub',:'owner1_user',false);
set role authenticated;
select public.apply_cloud_sync('sessions',:'o1_owner_id','never-uploaded',:'o1_member_id',5,
  repeat('d',64),jsonb_build_object('cloud_updated_at','2026-08-24T00:00:00Z'),now()) as delete_status \gset
select public.apply_cloud_sync('sessions',:'o1_owner_id','never-uploaded',:'o1_member_id',4,
  repeat('c',64),'{}'::jsonb,null) as stale_status \gset
reset role;
select count(*) as durable_tombstones from public.sync_tombstones
 where owner_id=:'o1_owner_id' and entity='sessions' and id='never-uploaded' \gset
select test.ok(:'delete_status'='applied' and :'stale_status'='stale' and :durable_tombstones::int=1,
  'delete-first must persist and reject stale resurrection');

-- Owner identity matrix: own reads and guarded writes work; cross-tenant access
-- and all direct DML remain forbidden.
select set_config('request.jwt.claim.sub',:'owner1_user',false),
       set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":true}',false);
set role authenticated;
select count(*) as owner1_own_reads from public.sessions where owner_id=:'o1_owner_id' \gset
select count(*) as owner1_cross_reads from public.sessions where owner_id=:'o2_owner_id' \gset
select count(*) as owner1_own_tombstones from public.sync_tombstones where owner_id=:'o1_owner_id' \gset
select count(*) as owner1_cross_tombstones from public.sync_tombstones where owner_id=:'o2_owner_id' \gset
select test.expect_error(
  format($q$select public.apply_cloud_sync('sessions',%L::uuid,'owner1-cross-write',%L::uuid,
    1,repeat('1',64),'{}'::jsonb,now())$q$,:'o2_owner_id',:'o1_member_id'),
  'writer membership required','owner must not write another owner tenant');
select test.expect_error(
  format($q$delete from public.sessions where owner_id=%L::uuid$q$,:'o1_owner_id'),
  'permission denied for table sessions','owner delete DML must be forbidden');
reset role;
select test.ok(:owner1_own_reads::int=1 and :owner1_cross_reads::int=0
    and :owner1_own_tombstones::int=1 and :owner1_cross_tombstones::int=0,
  'owner must read own data/tombstones and no cross-tenant data');

-- Pair a viewer, verify pending isolation, approve, then revoke.
select set_config('request.jwt.claim.sub',:'owner1_user',false);
set role authenticated;
select * from public.create_pairing_token(:'o1_owner_id','viewer','Viewer') \gset pair_v_
reset role;
select set_config('request.jwt.claim.sub',:'viewer_user',false),
       set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":true}',false);
set role authenticated;
select * from public.claim_pairing_token(:'pair_v_pairing_id',:'pair_v_one_time_secret') \gset viewer_
select count(*) as pending_reads from public.sessions where owner_id=:'o1_owner_id' \gset
select count(*) as pairing_replay_count from public.claim_pairing_token(
  :'pair_v_pairing_id',:'pair_v_one_time_secret') \gset
reset role;
select test.ok(:pending_reads::int=0,'pending viewer must not read tenant rows');
select test.ok(:pairing_replay_count::int=0,'pairing secret must be single-use');
select set_config('request.jwt.claim.sub',:'owner1_user',false);
set role authenticated;
select public.approve_member(:'o1_owner_id',:'viewer_member_id') as viewer_approved \gset
reset role;
select set_config('request.jwt.claim.sub',:'viewer_user',false);
set role authenticated;
select count(*) as approved_reads from public.sessions where owner_id=:'o1_owner_id' \gset
select count(*) as viewer_cross_reads from public.sessions where owner_id=:'o2_owner_id' \gset
select count(*) as viewer_own_tombstones from public.sync_tombstones where owner_id=:'o1_owner_id' \gset
select count(*) as viewer_cross_tombstones from public.sync_tombstones where owner_id=:'o2_owner_id' \gset
select test.expect_error(
  format($q$select public.apply_cloud_sync('sessions',%L::uuid,'viewer-own-write',%L::uuid,
    3,repeat('3',64),'{}'::jsonb,now())$q$,:'o1_owner_id',:'viewer_member_id'),
  'writer membership required','approved viewer guarded write must be denied within tenant');
select test.expect_error(
  format($q$select public.apply_cloud_sync('sessions',%L::uuid,'viewer-cross-write',%L::uuid,
    1,repeat('3',64),'{}'::jsonb,now())$q$,:'o2_owner_id',:'viewer_member_id'),
  'writer membership required','approved viewer cross-tenant write must be denied');
select test.expect_error(
  format($q$update public.sessions set title='viewer-direct-write' where owner_id=%L::uuid$q$,:'o1_owner_id'),
  'permission denied for table sessions','approved viewer direct DML must be forbidden');
reset role;
select test.ok(:approved_reads::int=1 and :viewer_cross_reads::int=0
    and :viewer_own_tombstones::int=1 and :viewer_cross_tombstones::int=0,
  'approved viewer must read own tenant only, including tombstones');
select set_config('request.jwt.claim.sub',:'owner1_user',false);
set role authenticated;
select public.revoke_member(:'o1_owner_id',:'viewer_member_id') as viewer_revoked \gset
reset role;
select set_config('request.jwt.claim.sub',:'viewer_user',false);
set role authenticated;
select count(*) as revoked_reads from public.sessions where owner_id=:'o1_owner_id' \gset
select count(*) as revoked_cross_reads from public.sessions where owner_id=:'o2_owner_id' \gset
select count(*) as revoked_tombstones from public.sync_tombstones
  where owner_id in (:'o1_owner_id',:'o2_owner_id') \gset
select test.expect_error(
  format($q$select public.apply_cloud_sync('sessions',%L::uuid,'revoked-own-write',%L::uuid,
    4,repeat('4',64),'{}'::jsonb,now())$q$,:'o1_owner_id',:'viewer_member_id'),
  'writer membership required','revoked member guarded write must be denied within former tenant');
select test.expect_error(
  format($q$select public.apply_cloud_sync('sessions',%L::uuid,'revoked-cross-write',%L::uuid,
    1,repeat('4',64),'{}'::jsonb,now())$q$,:'o2_owner_id',:'viewer_member_id'),
  'writer membership required','revoked member cross-tenant write must be denied');
select test.expect_error(
  format($q$delete from public.sessions where owner_id=%L::uuid$q$,:'o1_owner_id'),
  'permission denied for table sessions','revoked member direct DML must be forbidden');
reset role;
select test.ok(:revoked_reads::int=0 and :revoked_cross_reads::int=0 and :revoked_tombstones::int=0,
  'revoked viewer must immediately lose all own-tenant and cross-tenant data access');

-- Approved device can write only through the guarded RPC and can read only its
-- own tenant. It cannot use direct DML or write across tenants.
select set_config('request.jwt.claim.sub',:'owner1_user',false);
set role authenticated;
select * from public.create_pairing_token(:'o1_owner_id','device','Device') \gset pair_d_
reset role;
select set_config('request.jwt.claim.sub',:'device_user',false),
       set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":false}',false);
set role authenticated;
select * from public.claim_pairing_token(:'pair_d_pairing_id',:'pair_d_one_time_secret') \gset device_
reset role;
select set_config('request.jwt.claim.sub',:'owner1_user',false);
set role authenticated;
select public.approve_member(:'o1_owner_id',:'device_member_id');
reset role;
select set_config('request.jwt.claim.sub',:'device_user',false);
set role authenticated;
select public.apply_cloud_sync('sessions',:'o1_owner_id','device-session',:'device_member_id',1,
  repeat('b',64),jsonb_build_object(
    'schema_version',1,'source_id','source-device','native_session_id','native-device','agent_type','codex',
    'model_name','gpt','title','Untitled Session','status','completed','is_interrupted',false,
    'started_at','2026-08-24T00:00:00Z','updated_at','2026-08-24T00:00:00Z',
    'prompt_tokens',0,'completion_tokens',0,'total_tokens',0,'estimated_cost_microusd',0,
    'cost_estimate',jsonb_build_object('status','estimated','pricing_version','test-v1'),
    'is_archived',false,'legacy_unverified',false,'metadata','{}'::jsonb,'provenance','{}'::jsonb),null) as device_sync \gset
select count(*) as device_own_reads from public.sessions where owner_id=:'o1_owner_id' \gset
select count(*) as device_cross_reads from public.sessions where owner_id=:'o2_owner_id' \gset
select count(*) as device_own_tombstones from public.sync_tombstones where owner_id=:'o1_owner_id' \gset
select count(*) as device_cross_tombstones from public.sync_tombstones where owner_id=:'o2_owner_id' \gset
select test.expect_error(
  format($q$select public.apply_cloud_sync('sessions',%L::uuid,'device-cross-write',%L::uuid,
    1,repeat('5',64),'{}'::jsonb,now())$q$,:'o2_owner_id',:'device_member_id'),
  'writer membership required','approved device cross-tenant write must be denied');
select test.expect_error(
  format($q$update public.sessions set title='device-direct-write' where owner_id=%L::uuid$q$,:'o1_owner_id'),
  'permission denied for table sessions','approved device direct DML must be forbidden');
reset role;
select test.ok(:'device_sync'='applied' and :device_own_reads::int=2
    and :device_cross_reads::int=0 and :device_own_tombstones::int=1
    and :device_cross_tombstones::int=0,
  'approved device must write through RPC and read only its own tenant');

-- An authenticated role with no auth.uid() gets RLS-filtered reads and cannot
-- use the guarded RPC or direct DML.
select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false);
set role authenticated;
select count(*) as null_identity_reads from public.sessions
  where owner_id in (:'o1_owner_id',:'o2_owner_id') \gset
select count(*) as null_identity_tombstones from public.sync_tombstones
  where owner_id in (:'o1_owner_id',:'o2_owner_id') \gset
select test.expect_error(
  format($q$select public.apply_cloud_sync('sessions',%L::uuid,'null-identity-write',%L::uuid,
    1,repeat('6',64),'{}'::jsonb,now())$q$,:'o1_owner_id',:'o1_member_id'),
  'writer membership required','null authenticated identity guarded write must be denied');
select test.expect_error(
  format($q$delete from public.sessions where owner_id=%L::uuid$q$,:'o1_owner_id'),
  'permission denied for table sessions','null authenticated identity direct DML must be forbidden');
reset role;
select test.ok(:null_identity_reads::int=0 and :null_identity_tombstones::int=0,
  'null authenticated identity must read no tenant data');

-- The anon database role has neither table privileges nor RPC execution.
select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false);
set role anon;
select test.expect_error('select count(*) from public.sessions',
  'permission denied for table sessions','anonymous role table read must be denied');
select test.expect_error(
  format($q$select public.apply_cloud_sync('sessions',%L::uuid,'anon-write',%L::uuid,
    1,repeat('7',64),'{}'::jsonb,now())$q$,:'o1_owner_id',:'o1_member_id'),
  'permission denied for function apply_cloud_sync','anonymous role guarded RPC must be denied');
select test.expect_error(
  format($q$insert into public.sync_tombstones(owner_id,entity,id,created_by_member_id,
    payload_version,payload_hash,deleted_at) values (%L::uuid,'sessions','anon-direct',%L::uuid,
    1,repeat('7',64),now())$q$,:'o1_owner_id',:'o1_member_id'),
  'permission denied for table sync_tombstones','anonymous direct DML must be denied');
reset role;

-- Expiry and five-failure lockout are deterministic database transitions.
select set_config('request.jwt.claim.sub',:'owner1_user',false);
set role authenticated;
select * from public.create_pairing_token(:'o1_owner_id','viewer','Expired') \gset pair_e_
select * from public.create_pairing_token(:'o1_owner_id','viewer','Rate limited') \gset pair_f_
reset role;
update public.pairing_tokens set created_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute'
 where id=:'pair_e_pairing_id';
select set_config('request.jwt.claim.sub',:'expired_user',false),
       set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":true}',false);
set role authenticated;
select count(*) as expired_claims from public.claim_pairing_token(
  :'pair_e_pairing_id',:'pair_e_one_time_secret') \gset
reset role;
select test.ok(:expired_claims::int=0,'expired pairing must not claim');
select set_config('request.jwt.claim.sub',:'failed_user',false);
set role authenticated;
select count(*) from public.claim_pairing_token(:'pair_f_pairing_id','wrong-secret-00000000000000000000000000000001');
select count(*) from public.claim_pairing_token(:'pair_f_pairing_id','wrong-secret-00000000000000000000000000000002');
select count(*) from public.claim_pairing_token(:'pair_f_pairing_id','wrong-secret-00000000000000000000000000000003');
select count(*) from public.claim_pairing_token(:'pair_f_pairing_id','wrong-secret-00000000000000000000000000000004');
select count(*) from public.claim_pairing_token(:'pair_f_pairing_id','wrong-secret-00000000000000000000000000000005');
select count(*) as locked_claims from public.claim_pairing_token(
  :'pair_f_pairing_id',:'pair_f_one_time_secret') \gset
reset role;
select test.ok(:locked_claims::int=0,'pairing must lock after five failed attempts');

\echo 'All PostgreSQL RLS/bootstrap/pairing/sync security tests passed'
rollback;
