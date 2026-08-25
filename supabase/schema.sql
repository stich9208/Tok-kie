-- Tok-kie cloud schema v2.
-- Public-all v1 rows are quarantined because they have no trustworthy tenant.
-- An authenticated owner must explicitly adopt them with adopt_quarantined_v1().

begin;
create extension if not exists pgcrypto with schema extensions;
drop view if exists public.v_daily_stats;
drop view if exists public.v_monthly_stats;

do $migration$
begin
  if to_regclass('public.sessions') is not null and not exists (
    select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'sessions' and column_name = 'owner_id'
  ) then
    if to_regclass('public.sessions_v1_insecure_quarantine') is not null
       or to_regclass('public.steps_v1_insecure_quarantine') is not null then
      raise exception 'Cannot quarantine v1: a quarantine table already exists';
    end if;
    if to_regclass('public.steps') is not null then
      alter table public.steps rename to steps_v1_insecure_quarantine;
    end if;
    alter table public.sessions rename to sessions_v1_insecure_quarantine;
  end if;
end $migration$;

-- Stable empty quarantine tables make the explicit adoption RPC valid on fresh DBs.
create table if not exists public.sessions_v1_insecure_quarantine (
  id text primary key, device_name text not null default 'Unknown Mac',
  user_email text default 'unknown', account_type text default 'personal',
  agent_type text not null, model_name text default 'unknown',
  title text default 'Untitled Session', started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), total_prompt_tokens bigint default 0,
  total_completion_tokens bigint default 0, total_tokens bigint default 0,
  estimated_cost_usd numeric(18, 6) default 0, status text default 'completed',
  is_interrupted boolean default false, is_archived boolean default false,
  metadata jsonb default '{}'::jsonb
);
create table if not exists public.steps_v1_insecure_quarantine (
  id text primary key,
  session_id text not null references public.sessions_v1_insecure_quarantine(id) on delete cascade,
  device_name text not null default 'Unknown Mac', user_email text default 'unknown',
  account_type text default 'personal', step_index integer not null,
  source text not null default 'assistant', action_type text default 'chat',
  prompt_tokens integer default 0, completion_tokens integer default 0,
  total_tokens integer default 0, preview_text text,
  timestamp timestamptz not null default now(), metadata jsonb default '{}'::jsonb
);
alter table public.sessions_v1_insecure_quarantine add column if not exists migrated_owner_id uuid;
alter table public.steps_v1_insecure_quarantine add column if not exists migrated_owner_id uuid;

-- Remove all inherited v1 policies, including the old USING (true) policies.
do $policies$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in
      ('sessions_v1_insecure_quarantine', 'steps_v1_insecure_quarantine')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $policies$;
alter table public.sessions_v1_insecure_quarantine enable row level security;
alter table public.sessions_v1_insecure_quarantine force row level security;
alter table public.steps_v1_insecure_quarantine enable row level security;
alter table public.steps_v1_insecure_quarantine force row level security;
revoke all on public.sessions_v1_insecure_quarantine from public, anon, authenticated;
revoke all on public.steps_v1_insecure_quarantine from public, anon, authenticated;

create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now()
);
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.owners(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'viewer', 'device')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  approved_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now(),
  unique (auth_user_id), unique (owner_id, id),
  check (revoked_at is null or approved_at is not null)
);
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, member_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  last_seen_at timestamptz, created_at timestamptz not null default now(),
  unique (owner_id, member_id),
  foreign key (owner_id, member_id) references public.members(owner_id, id) on delete cascade
);
create table if not exists public.pairing_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  created_by_member_id uuid not null, token_hash bytea not null unique,
  requested_role text not null check (requested_role in ('viewer', 'device')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  consumed_at timestamptz, claimed_by_auth_user_id uuid references auth.users(id),
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  foreign key (owner_id, created_by_member_id) references public.members(owner_id, id),
  check (expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
  check ((consumed_at is null) = (claimed_by_auth_user_id is null))
);

-- Management OAuth may install only a SHA-256 digest here. The desktop proves
-- possession of the raw 256-bit secret over an authenticated data-plane RPC.
-- Manual fallback uses the same contract: generate a random secret outside SQL,
-- run `select public.install_owner_bootstrap(decode('<sha256 hex>', 'hex'));` as
-- the project database administrator, then supply the raw secret only to the
-- trusted main-process updateSettings(..., secret) API. A publishable key alone
-- can never bootstrap an owner.
create table if not exists public.owner_bootstrap_tokens (
  singleton boolean primary key default true check (singleton),
  secret_hash bytea not null check (octet_length(secret_hash) = 32),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

create table if not exists public.sessions (
  owner_id uuid not null references public.owners(id) on delete cascade, id text not null,
  created_by_member_id uuid not null, schema_version integer not null check (schema_version > 0),
  source_id text not null, native_session_id text not null,
  agent_type text not null check (agent_type in ('claude_code','codex','antigravity','aider','unknown')),
  model_name text not null, title text not null,
  status text not null check (status in ('running','completed','interrupted','failed')),
  is_interrupted boolean not null default false, started_at timestamptz not null,
  updated_at timestamptz not null, prompt_tokens bigint not null check (prompt_tokens >= 0),
  completion_tokens bigint not null check (completion_tokens >= 0),
  total_tokens bigint not null check (total_tokens >= 0),
  estimated_cost_microusd bigint check (estimated_cost_microusd is null or estimated_cost_microusd >= 0),
  cost_estimate jsonb not null check (jsonb_typeof(cost_estimate)='object'
    and cost_estimate ->> 'status' in ('estimated','reported','unavailable')
    and jsonb_typeof(cost_estimate -> 'pricing_version')='string'
    and ((estimated_cost_microusd is null) = (cost_estimate ->> 'status' = 'unavailable'))),
  is_archived boolean not null default false, legacy_unverified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb, provenance jsonb not null default '{}'::jsonb,
  payload_version bigint not null check (payload_version > 0),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  deleted_at timestamptz, cloud_updated_at timestamptz not null default now(),
  primary key (owner_id, id), unique (owner_id, source_id, native_session_id),
  foreign key (owner_id, created_by_member_id) references public.members(owner_id, id)
);
create table if not exists public.steps (
  owner_id uuid not null, id text not null, session_id text not null,
  created_by_member_id uuid not null, schema_version integer not null check (schema_version > 0),
  source_id text not null, native_step_id text not null, step_index integer not null check (step_index >= 0),
  source text not null check (source in ('turn','user','assistant','tool','system','subagent')),
  action_type text not null,
  status text not null check (status in ('running','completed','interrupted','failed')),
  is_interrupted boolean not null default false, prompt_tokens bigint not null check (prompt_tokens >= 0),
  completion_tokens bigint not null check (completion_tokens >= 0),
  total_tokens bigint not null check (total_tokens >= 0), occurred_at timestamptz not null,
  legacy_unverified boolean not null default false, metadata jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb, payload_version bigint not null check (payload_version > 0),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  deleted_at timestamptz, cloud_updated_at timestamptz not null default now(),
  primary key (owner_id, id), unique (owner_id, session_id, native_step_id),
  foreign key (owner_id, session_id) references public.sessions(owner_id, id) on delete cascade,
  foreign key (owner_id, created_by_member_id) references public.members(owner_id, id)
);
create table if not exists public.sync_tombstones (
  owner_id uuid not null references public.owners(id) on delete cascade,
  entity text not null check (entity in ('sessions','steps')),
  id text not null,
  created_by_member_id uuid not null,
  payload_version bigint not null check (payload_version > 0),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  deleted_at timestamptz not null,
  cloud_updated_at timestamptz not null default now(),
  primary key (owner_id, entity, id),
  foreign key (owner_id, created_by_member_id) references public.members(owner_id, id)
);
create index if not exists sessions_v2_started_idx on public.sessions(owner_id, started_at desc, id);
create index if not exists sessions_v2_updated_idx on public.sessions(owner_id, cloud_updated_at);
create index if not exists steps_v2_session_idx on public.steps(owner_id, session_id, step_index, id);
create index if not exists steps_v2_updated_idx on public.steps(owner_id, cloud_updated_at);
create index if not exists members_v2_owner_idx on public.members(owner_id, role) where revoked_at is null;
create index if not exists pairing_tokens_active_idx on public.pairing_tokens(owner_id, expires_at) where consumed_at is null;
create index if not exists sync_tombstones_updated_idx on public.sync_tombstones(owner_id, cloud_updated_at);

-- Fixed-search-path SECURITY DEFINER helpers avoid recursive member-table RLS.
create or replace function public.current_member_id(p_owner_id uuid) returns uuid
language sql stable security definer set search_path = pg_catalog, public set row_security = off
as $$ select m.id from public.members m where m.owner_id = p_owner_id
  and m.auth_user_id = auth.uid() and m.approved_at is not null and m.revoked_at is null limit 1 $$;
create or replace function public.member_can_read(p_owner_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public set row_security = off
as $$ select exists (select 1 from public.members m where m.owner_id = p_owner_id
  and m.auth_user_id = auth.uid() and m.approved_at is not null and m.revoked_at is null
  and m.role in ('owner','viewer','device')) $$;
create or replace function public.member_can_write(p_owner_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public set row_security = off
as $$ select exists (select 1 from public.members m where m.owner_id = p_owner_id
  and m.auth_user_id = auth.uid() and m.approved_at is not null and m.revoked_at is null
  and m.role in ('owner','device')) $$;
create or replace function public.member_can_manage(p_owner_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public set row_security = off
as $$ select exists (select 1 from public.members m where m.owner_id = p_owner_id
  and m.auth_user_id = auth.uid() and m.approved_at is not null and m.revoked_at is null
  and m.role = 'owner') $$;
revoke all on function public.current_member_id(uuid) from public;
revoke all on function public.member_can_read(uuid) from public;
revoke all on function public.member_can_write(uuid) from public;
revoke all on function public.member_can_manage(uuid) from public;
grant execute on function public.current_member_id(uuid) to authenticated;
grant execute on function public.member_can_read(uuid) to authenticated;
grant execute on function public.member_can_write(uuid) to authenticated;
grant execute on function public.member_can_manage(uuid) to authenticated;

alter table public.owners enable row level security; alter table public.owners force row level security;
alter table public.members enable row level security; alter table public.members force row level security;
alter table public.devices enable row level security; alter table public.devices force row level security;
alter table public.pairing_tokens enable row level security; alter table public.pairing_tokens force row level security;
alter table public.owner_bootstrap_tokens enable row level security; alter table public.owner_bootstrap_tokens force row level security;
alter table public.sessions enable row level security; alter table public.sessions force row level security;
alter table public.steps enable row level security; alter table public.steps force row level security;
alter table public.sync_tombstones enable row level security; alter table public.sync_tombstones force row level security;

drop policy if exists owners_read on public.owners;
drop policy if exists members_read_self_or_owner on public.members;
drop policy if exists devices_read_self_or_owner on public.devices;
drop policy if exists sessions_read on public.sessions;
drop policy if exists steps_read on public.steps;
drop policy if exists tombstones_read on public.sync_tombstones;
create policy owners_read on public.owners for select to authenticated using (public.member_can_read(id));
create policy members_read_self_or_owner on public.members for select to authenticated
  using (auth_user_id = auth.uid() or public.member_can_manage(owner_id));
create policy devices_read_self_or_owner on public.devices for select to authenticated
  using (member_id = public.current_member_id(owner_id) or public.member_can_manage(owner_id));
create policy sessions_read on public.sessions for select to authenticated using (public.member_can_read(owner_id));
create policy steps_read on public.steps for select to authenticated using (public.member_can_read(owner_id));
create policy tombstones_read on public.sync_tombstones for select to authenticated
  using (public.member_can_read(owner_id));

revoke all on public.owners, public.members, public.devices, public.pairing_tokens,
  public.owner_bootstrap_tokens, public.sessions, public.steps, public.sync_tombstones
  from public, anon, authenticated;
grant select on public.owners, public.members, public.devices to authenticated;
grant select on public.sessions, public.steps, public.sync_tombstones to authenticated;

-- SQL-editor/management-plane only. No data-plane role receives EXECUTE.
create or replace function public.install_owner_bootstrap(p_secret_hash bytea) returns void
language plpgsql security definer set search_path = pg_catalog, public set row_security = off as $$
begin
  if p_secret_hash is null or octet_length(p_secret_hash) <> 32 then
    raise exception 'bootstrap digest must be SHA-256';
  end if;
  insert into public.owner_bootstrap_tokens(singleton, secret_hash, created_at, expires_at,
    consumed_at, failed_attempts)
  values (true, p_secret_hash, now(), now() + interval '10 minutes', null, 0)
  on conflict (singleton) do update set secret_hash=excluded.secret_hash,
    created_at=excluded.created_at, expires_at=excluded.expires_at,
    consumed_at=null, failed_attempts=0;
end $$;

create or replace function public.claim_owner_bootstrap(p_one_time_secret text, p_display_name text)
returns table(owner_id uuid, member_id uuid) language plpgsql security definer
set search_path = pg_catalog, public, extensions set row_security = off as $$
declare v_token public.owner_bootstrap_tokens%rowtype; v_owner_id uuid; v_member_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true' then
    raise exception 'bootstrap requires a fresh anonymous data-plane session'; end if;
  if exists (select 1 from public.members where auth_user_id = auth.uid()) then
    raise exception 'auth user already belongs to an owner'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 120 then
    raise exception 'invalid display name'; end if;
  select * into v_token from public.owner_bootstrap_tokens where singleton for update;
  if not found or v_token.consumed_at is not null or v_token.expires_at <= now()
     or v_token.failed_attempts >= 5 then return; end if;
  if p_one_time_secret is null or v_token.secret_hash <>
     extensions.digest(convert_to(p_one_time_secret, 'UTF8'), 'sha256') then
    update public.owner_bootstrap_tokens set failed_attempts=least(failed_attempts+1,5)
      where singleton;
    return;
  end if;
  insert into public.owners(display_name) values (btrim(p_display_name)) returning id into v_owner_id;
  insert into public.members(owner_id, auth_user_id, role, display_name, approved_at)
    values (v_owner_id, auth.uid(), 'owner', btrim(p_display_name), now()) returning id into v_member_id;
  update public.owner_bootstrap_tokens set consumed_at=now() where singleton;
  return query select v_owner_id, v_member_id;
end $$;

create or replace function public.create_pairing_token(p_owner_id uuid, p_requested_role text, p_display_name text)
returns table(pairing_id uuid, one_time_secret text, expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, extensions set row_security = off as $$
declare v_secret text; v_pairing_id uuid; v_expires_at timestamptz;
begin
  if not public.member_can_manage(p_owner_id) then raise exception 'owner role required'; end if;
  if p_requested_role not in ('viewer','device') then raise exception 'invalid pairing role'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 120 then
    raise exception 'invalid display name'; end if;
  v_secret := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  v_expires_at := now() + interval '5 minutes';
  insert into public.pairing_tokens(owner_id, created_by_member_id, token_hash,
    requested_role, display_name, expires_at)
  values (p_owner_id, public.current_member_id(p_owner_id),
    extensions.digest(convert_to(v_secret, 'UTF8'), 'sha256'), p_requested_role,
    btrim(p_display_name), v_expires_at) returning id into v_pairing_id;
  return query select v_pairing_id, v_secret, v_expires_at;
end $$;

create or replace function public.claim_pairing_token(p_pairing_id uuid, p_one_time_secret text)
returns table(member_id uuid, owner_id uuid, role text, approval_pending boolean)
language plpgsql security definer set search_path = pg_catalog, public, extensions set row_security = off as $$
declare v_token public.pairing_tokens%rowtype; v_member_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_token from public.pairing_tokens where id = p_pairing_id for update;
  if not found or v_token.consumed_at is not null or v_token.failed_attempts >= 5 then return; end if;
  if v_token.expires_at <= now() then return; end if;
  if p_one_time_secret is null or v_token.token_hash <>
    extensions.digest(convert_to(p_one_time_secret, 'UTF8'), 'sha256') then
    update public.pairing_tokens set failed_attempts = least(failed_attempts + 1, 5)
      where id = p_pairing_id; return;
  end if;
  if coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true'
    and v_token.requested_role <> 'viewer' then return; end if;
  if exists (select 1 from public.members where auth_user_id = auth.uid()) then return; end if;
  update public.pairing_tokens set consumed_at = now(), claimed_by_auth_user_id = auth.uid()
    where id = p_pairing_id;
  insert into public.members(owner_id, auth_user_id, role, display_name)
    values (v_token.owner_id, auth.uid(), v_token.requested_role, v_token.display_name)
    returning id into v_member_id;
  if v_token.requested_role = 'device' then
    insert into public.devices(owner_id, member_id, display_name)
      values (v_token.owner_id, v_member_id, v_token.display_name);
  end if;
  return query select v_member_id, v_token.owner_id, v_token.requested_role, true;
end $$;

create or replace function public.approve_member(p_owner_id uuid, p_member_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public set row_security = off as $$
begin
  if not public.member_can_manage(p_owner_id) then raise exception 'owner role required'; end if;
  update public.members set approved_at = coalesce(approved_at, now())
    where owner_id = p_owner_id and id = p_member_id and revoked_at is null and role <> 'owner';
  return found;
end $$;
create or replace function public.revoke_member(p_owner_id uuid, p_member_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public set row_security = off as $$
begin
  if not public.member_can_manage(p_owner_id) then raise exception 'owner role required'; end if;
  update public.members set revoked_at = now()
    where owner_id = p_owner_id and id = p_member_id and role <> 'owner' and revoked_at is null;
  return found;
end $$;

-- Sole write path for synced rows. It makes retries idempotent, rejects equal-
-- version hash conflicts, ignores stale versions, and records delete-first
-- operations in sync_tombstones so an absent-row PATCH can never be mistaken
-- for a durable acknowledgement.
create or replace function public.apply_cloud_sync(
  p_entity text, p_owner_id uuid, p_id text, p_created_by_member_id uuid,
  p_payload_version bigint, p_payload_hash text, p_fields jsonb,
  p_deleted_at timestamptz default null
) returns text language plpgsql security definer
set search_path = pg_catalog, public set row_security = off as $$
declare
  v_current_version bigint; v_current_hash text;
  v_tombstone_version bigint; v_tombstone_hash text;
  v_session public.sessions%rowtype; v_step public.steps%rowtype;
begin
  if p_entity not in ('sessions','steps') or p_id is null or p_id = ''
     or p_payload_version is null or p_payload_version <= 0
     or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$'
     or p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid sync envelope';
  end if;
  if not public.member_can_write(p_owner_id)
     or p_created_by_member_id <> public.current_member_id(p_owner_id) then
    raise exception 'writer membership required';
  end if;

  -- Row locks do not serialize two first writes when neither the entity nor a
  -- tombstone exists yet. Lock the logical owner/entity/id key first so a
  -- concurrent older version can never pass the preflight and overwrite a
  -- newer insert through ON CONFLICT.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_owner_id::text || ':' || p_entity || ':' || p_id, 0));

  select payload_version,payload_hash into v_tombstone_version,v_tombstone_hash
    from public.sync_tombstones
    where owner_id=p_owner_id and entity=p_entity and id=p_id for update;
  if p_entity = 'sessions' then
    select payload_version,payload_hash into v_current_version,v_current_hash
      from public.sessions where owner_id=p_owner_id and id=p_id for update;
  else
    select payload_version,payload_hash into v_current_version,v_current_hash
      from public.steps where owner_id=p_owner_id and id=p_id for update;
  end if;

  if (v_current_version = p_payload_version and v_current_hash <> p_payload_hash)
     or (v_tombstone_version = p_payload_version and v_tombstone_hash <> p_payload_hash) then
    raise exception 'sync version/hash conflict';
  end if;
  if (v_current_version = p_payload_version and v_current_hash = p_payload_hash)
     or (v_tombstone_version = p_payload_version and v_tombstone_hash = p_payload_hash) then
    return 'idempotent';
  end if;
  if coalesce(greatest(v_current_version,v_tombstone_version),v_current_version,v_tombstone_version,0)
     > p_payload_version then return 'stale'; end if;

  if p_deleted_at is not null then
    insert into public.sync_tombstones(owner_id,entity,id,created_by_member_id,
      payload_version,payload_hash,deleted_at,cloud_updated_at)
    values (p_owner_id,p_entity,p_id,p_created_by_member_id,p_payload_version,
      p_payload_hash,p_deleted_at,now())
    on conflict (owner_id,entity,id) do update set
      created_by_member_id=excluded.created_by_member_id,
      payload_version=excluded.payload_version,payload_hash=excluded.payload_hash,
      deleted_at=excluded.deleted_at,cloud_updated_at=excluded.cloud_updated_at;
    if p_entity = 'sessions' then
      update public.sessions set deleted_at=p_deleted_at,cloud_updated_at=now(),
        payload_version=p_payload_version,payload_hash=p_payload_hash,
        created_by_member_id=p_created_by_member_id
        where owner_id=p_owner_id and id=p_id;
    else
      update public.steps set deleted_at=p_deleted_at,cloud_updated_at=now(),
        payload_version=p_payload_version,payload_hash=p_payload_hash,
        created_by_member_id=p_created_by_member_id
        where owner_id=p_owner_id and id=p_id;
    end if;
    return 'applied';
  end if;

  delete from public.sync_tombstones where owner_id=p_owner_id and entity=p_entity and id=p_id;
  if p_entity = 'sessions' then
    v_session := jsonb_populate_record(null::public.sessions, p_fields || jsonb_build_object(
      'owner_id',p_owner_id,'id',p_id,'created_by_member_id',p_created_by_member_id,
      'payload_version',p_payload_version,'payload_hash',p_payload_hash,
      'deleted_at',null,'cloud_updated_at',now()));
    insert into public.sessions select v_session.*
    on conflict (owner_id,id) do update set
      created_by_member_id=excluded.created_by_member_id,schema_version=excluded.schema_version,
      source_id=excluded.source_id,native_session_id=excluded.native_session_id,
      agent_type=excluded.agent_type,model_name=excluded.model_name,title=excluded.title,
      status=excluded.status,is_interrupted=excluded.is_interrupted,
      started_at=excluded.started_at,updated_at=excluded.updated_at,
      prompt_tokens=excluded.prompt_tokens,completion_tokens=excluded.completion_tokens,
      total_tokens=excluded.total_tokens,estimated_cost_microusd=excluded.estimated_cost_microusd,
      cost_estimate=excluded.cost_estimate,
      is_archived=excluded.is_archived,legacy_unverified=excluded.legacy_unverified,
      metadata=excluded.metadata,provenance=excluded.provenance,
      payload_version=excluded.payload_version,payload_hash=excluded.payload_hash,
      deleted_at=excluded.deleted_at,cloud_updated_at=excluded.cloud_updated_at;
  else
    v_step := jsonb_populate_record(null::public.steps, p_fields || jsonb_build_object(
      'owner_id',p_owner_id,'id',p_id,'created_by_member_id',p_created_by_member_id,
      'payload_version',p_payload_version,'payload_hash',p_payload_hash,
      'deleted_at',null,'cloud_updated_at',now()));
    insert into public.steps select v_step.*
    on conflict (owner_id,id) do update set
      session_id=excluded.session_id,created_by_member_id=excluded.created_by_member_id,
      schema_version=excluded.schema_version,source_id=excluded.source_id,
      native_step_id=excluded.native_step_id,step_index=excluded.step_index,
      source=excluded.source,action_type=excluded.action_type,status=excluded.status,
      is_interrupted=excluded.is_interrupted,prompt_tokens=excluded.prompt_tokens,
      completion_tokens=excluded.completion_tokens,total_tokens=excluded.total_tokens,
      occurred_at=excluded.occurred_at,legacy_unverified=excluded.legacy_unverified,
      metadata=excluded.metadata,provenance=excluded.provenance,
      payload_version=excluded.payload_version,payload_hash=excluded.payload_hash,
      deleted_at=excluded.deleted_at,cloud_updated_at=excluded.cloud_updated_at;
  end if;
  return 'applied';
end $$;

create or replace function public.adopt_quarantined_v1(p_owner_id uuid)
returns table(sessions_imported bigint, steps_imported bigint)
language plpgsql security definer set search_path = pg_catalog, public, extensions set row_security = off as $$
declare v_member_id uuid; v_sessions bigint; v_steps bigint;
begin
  if not public.member_can_manage(p_owner_id) then raise exception 'owner role required'; end if;
  v_member_id := public.current_member_id(p_owner_id);
  insert into public.sessions(owner_id,id,created_by_member_id,schema_version,source_id,
    native_session_id,agent_type,model_name,title,status,is_interrupted,started_at,updated_at,
    prompt_tokens,completion_tokens,total_tokens,estimated_cost_microusd,cost_estimate,is_archived,
    legacy_unverified,provenance,payload_version,payload_hash)
  select p_owner_id,q.id,v_member_id,1,'legacy:supabase:v1',q.id,
    case when q.agent_type in ('claude_code','codex','antigravity','aider') then q.agent_type else 'unknown' end,
    coalesce(q.model_name,'unknown'),coalesce(q.title,'Untitled Session'),
    case when q.status in ('running','completed','interrupted','failed') then q.status else 'completed' end,
    coalesce(q.is_interrupted,false),q.started_at,q.updated_at,
    greatest(coalesce(q.total_prompt_tokens,0),0), greatest(coalesce(q.total_completion_tokens,0),0),
    greatest(coalesce(q.total_tokens,0),0),
    greatest(round(coalesce(q.estimated_cost_usd,0)*1000000)::bigint,0),
    jsonb_build_object('status','reported','pricing_version','legacy-supabase-v1'),
    coalesce(q.is_archived,false),true,
    jsonb_build_object('verification','legacy_unverified','migrated_from','supabase_v1'),1,
    encode(extensions.digest(convert_to(row_to_json(q)::text,'UTF8'),'sha256'),'hex')
  from public.sessions_v1_insecure_quarantine q where q.migrated_owner_id is null
  on conflict (owner_id,id) do nothing;
  get diagnostics v_sessions = row_count;
  insert into public.steps(owner_id,id,session_id,created_by_member_id,schema_version,
    source_id,native_step_id,step_index,source,action_type,status,is_interrupted,
    prompt_tokens,completion_tokens,total_tokens,occurred_at,legacy_unverified,
    provenance,payload_version,payload_hash)
  select p_owner_id,q.id,q.session_id,v_member_id,1,'legacy:supabase:v1',q.id,
    greatest(q.step_index,0),
    case when q.source in ('turn','user','assistant','tool','system','subagent') then q.source else 'system' end,
    coalesce(q.action_type,'chat'),'completed',false,greatest(coalesce(q.prompt_tokens,0),0),
    greatest(coalesce(q.completion_tokens,0),0),greatest(coalesce(q.total_tokens,0),0),
    q.timestamp,true,jsonb_build_object('verification','legacy_unverified','migrated_from','supabase_v1'),1,
    encode(extensions.digest(convert_to(row_to_json(q)::text,'UTF8'),'sha256'),'hex')
  from public.steps_v1_insecure_quarantine q where q.migrated_owner_id is null
    and exists (select 1 from public.sessions s where s.owner_id=p_owner_id and s.id=q.session_id)
  on conflict (owner_id,id) do nothing;
  get diagnostics v_steps = row_count;
  update public.sessions_v1_insecure_quarantine set migrated_owner_id=p_owner_id where migrated_owner_id is null;
  update public.steps_v1_insecure_quarantine q set migrated_owner_id=p_owner_id
    where migrated_owner_id is null and exists
      (select 1 from public.steps s where s.owner_id=p_owner_id and s.id=q.id);
  return query select v_sessions,v_steps;
end $$;

revoke all on function public.install_owner_bootstrap(bytea) from public, anon, authenticated;
revoke all on function public.claim_owner_bootstrap(text,text) from public;
revoke all on function public.create_pairing_token(uuid,text,text) from public;
revoke all on function public.claim_pairing_token(uuid,text) from public;
revoke all on function public.approve_member(uuid,uuid) from public;
revoke all on function public.revoke_member(uuid,uuid) from public;
revoke all on function public.apply_cloud_sync(text,uuid,text,uuid,bigint,text,jsonb,timestamptz) from public;
revoke all on function public.adopt_quarantined_v1(uuid) from public;
grant execute on function public.claim_owner_bootstrap(text,text) to authenticated;
grant execute on function public.create_pairing_token(uuid,text,text) to authenticated;
grant execute on function public.claim_pairing_token(uuid,text) to authenticated;
grant execute on function public.approve_member(uuid,uuid) to authenticated;
grant execute on function public.revoke_member(uuid,uuid) to authenticated;
grant execute on function public.apply_cloud_sync(text,uuid,text,uuid,bigint,text,jsonb,timestamptz) to authenticated;
grant execute on function public.adopt_quarantined_v1(uuid) to authenticated;

create view public.v_daily_stats with (security_invoker = true) as
select owner_id,date_trunc('day',started_at at time zone 'UTC')::date as day,
  agent_type,model_name,count(*) as session_count,sum(prompt_tokens) as prompt_tokens,
  sum(completion_tokens) as completion_tokens,sum(total_tokens) as total_tokens,
  sum(estimated_cost_microusd) as estimated_cost_microusd
from public.sessions where deleted_at is null and not is_archived
group by owner_id,2,agent_type,model_name;
create view public.v_monthly_stats with (security_invoker = true) as
select owner_id,date_trunc('month',started_at at time zone 'UTC')::date as month,
  agent_type,count(*) as session_count,sum(total_tokens) as total_tokens,
  sum(estimated_cost_microusd) as estimated_cost_microusd
from public.sessions where deleted_at is null and not is_archived
group by owner_id,2,agent_type;
revoke all on public.v_daily_stats,public.v_monthly_stats from public,anon;
grant select on public.v_daily_stats,public.v_monthly_stats to authenticated;
commit;
