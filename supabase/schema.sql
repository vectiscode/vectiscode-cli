create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to service_role;

create table if not exists public.vectis_collections (
  collection_name text not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection_name, id)
);

create unique index if not exists vectis_collections_id_collection_name_key
  on public.vectis_collections (id, collection_name);

create index if not exists vectis_collections_collection_name_idx
  on public.vectis_collections (collection_name);

drop index if exists public.vectis_collections_data_gin_idx;

create index if not exists vectis_collections_project_id_idx
  on public.vectis_collections (collection_name, (data->>'projectId'));

create index if not exists vectis_collections_organization_id_idx
  on public.vectis_collections (collection_name, (data->>'organizationId'));

create index if not exists vectis_collections_user_id_idx
  on public.vectis_collections (collection_name, (data->>'userId'));

create index if not exists vectis_collections_thread_id_idx
  on public.vectis_collections (collection_name, (data->>'threadId'));

create index if not exists vectis_collections_session_id_idx
  on public.vectis_collections (collection_name, (data->>'sessionId'));

create index if not exists vectis_collections_studio_session_id_idx
  on public.vectis_collections (collection_name, (data->>'studioSessionId'));

create index if not exists vectis_collections_change_set_id_idx
  on public.vectis_collections (collection_name, (data->>'changeSetId'));

create index if not exists vectis_collections_google_user_id_idx
  on public.vectis_collections (collection_name, (data->>'googleUserId'));

create index if not exists vectis_collections_roblox_user_id_idx
  on public.vectis_collections (collection_name, (data->>'robloxUserId'));

create index if not exists vectis_collections_auth_provider_idx
  on public.vectis_collections (collection_name, (data->>'authProvider'));

create index if not exists vectis_collections_status_idx
  on public.vectis_collections (collection_name, (data->>'status'));

create index if not exists vectis_collections_upload_id_idx
  on public.vectis_collections (collection_name, (data->>'uploadId'));

create index if not exists vectis_collections_stripe_customer_id_idx
  on public.vectis_collections (collection_name, (data->>'stripeCustomerId'));

create index if not exists vectis_collections_stripe_subscription_id_idx
  on public.vectis_collections (collection_name, (data->>'stripeSubscriptionId'));

create or replace function public.set_vectis_collections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vectis_collections_updated_at on public.vectis_collections;
create trigger vectis_collections_updated_at
before update on public.vectis_collections
for each row
execute function public.set_vectis_collections_updated_at();

alter table public.vectis_collections enable row level security;

revoke all on public.vectis_collections from anon;
revoke all on public.vectis_collections from authenticated;
grant select, insert, update, delete on public.vectis_collections to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vectis-attachments',
  'vectis-attachments',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/x-lua', 'application/yaml', 'application/x-yaml', 'application/toml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

delete from public.vectis_collections target
using (
  select collection_name, id
  from (
    select
      collection_name,
      id,
      row_number() over (
        partition by data->>'stripeEventId'
        order by updated_at desc, created_at desc, id desc
      ) as duplicate_rank
    from public.vectis_collections
    where collection_name = 'stripeProcessedEvents'
      and (data->>'stripeEventId') is not null
      and (data->>'stripeEventId') <> ''
  ) ranked
  where duplicate_rank > 1
) duplicates
where target.collection_name = duplicates.collection_name
  and target.id = duplicates.id;

create unique index if not exists vectis_collections_stripe_event_id_uniq
  on public.vectis_collections (collection_name, (data->>'stripeEventId'))
  where collection_name = 'stripeProcessedEvents'
    and (data->>'stripeEventId') is not null
    and (data->>'stripeEventId') <> '';

create table if not exists private.vectis_credit_balances (
  organization_id text primary key,
  balance bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table private.vectis_credit_balances enable row level security;
revoke all on table private.vectis_credit_balances from public;
revoke all on table private.vectis_credit_balances from anon;
revoke all on table private.vectis_credit_balances from authenticated;

create or replace function private.vectis_adjust_credit_balance(
  p_organization_id text,
  p_delta bigint
) returns void
language sql
security definer
set search_path = private, public
as $$
  insert into private.vectis_credit_balances (organization_id, balance, updated_at)
  select p_organization_id, p_delta, now()
  where nullif(p_organization_id, '') is not null
    and p_delta <> 0
  on conflict (organization_id) do update set
    balance = private.vectis_credit_balances.balance + excluded.balance,
    updated_at = excluded.updated_at;
$$;

create or replace function private.vectis_sync_credit_balance()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE')
    and old.collection_name = 'ledger'
    and nullif(old.data->>'organizationId', '') is not null
    and coalesce(old.data->>'delta', '') ~ '^-?[0-9]+$'
  then
    perform private.vectis_adjust_credit_balance(
      old.data->>'organizationId',
      -(old.data->>'delta')::bigint
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and new.collection_name = 'ledger'
    and nullif(new.data->>'organizationId', '') is not null
    and coalesce(new.data->>'delta', '') ~ '^-?[0-9]+$'
  then
    perform private.vectis_adjust_credit_balance(
      new.data->>'organizationId',
      (new.data->>'delta')::bigint
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists vectis_credit_balance_sync on public.vectis_collections;
create trigger vectis_credit_balance_sync
after insert or update or delete on public.vectis_collections
for each row
execute function private.vectis_sync_credit_balance();

insert into private.vectis_credit_balances (organization_id, balance, updated_at)
select data->>'organizationId', sum((data->>'delta')::bigint), now()
from public.vectis_collections
where collection_name = 'ledger'
  and nullif(data->>'organizationId', '') is not null
  and coalesce(data->>'delta', '') ~ '^-?[0-9]+$'
group by data->>'organizationId'
on conflict (organization_id) do update set
  balance = excluded.balance,
  updated_at = excluded.updated_at;

revoke all on function private.vectis_adjust_credit_balance(text, bigint) from public;
revoke all on function private.vectis_sync_credit_balance() from public;

create or replace function private.vectis_try_deduct_credits(
  p_organization_id text,
  p_amount int,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_balance bigint;
  v_new_id text;
  v_now_iso text;
begin
  perform pg_advisory_xact_lock(hashtext('vectis_deduct:' || p_organization_id));

  select coalesce((
    select balance
    from private.vectis_credit_balances
    where organization_id = p_organization_id
  ), 0)
  into v_balance
  ;

  if p_amount <= 0 then
    return jsonb_build_object('ok', true, 'balance', v_balance);
  end if;

  if v_balance < p_amount then
    return jsonb_build_object('ok', false, 'balance', v_balance);
  end if;

  v_new_id := 'ledger_' || replace(gen_random_uuid()::text, '-', '');
  v_now_iso := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  insert into public.vectis_collections (collection_name, id, data, created_at, updated_at)
  values (
    'ledger',
    v_new_id,
    jsonb_build_object(
      'id', v_new_id,
      'organizationId', p_organization_id,
      'delta', -p_amount,
      'reason', p_reason,
      'createdAt', v_now_iso
    ),
    now(),
    now()
  );

  return jsonb_build_object('ok', true, 'balance', v_balance - p_amount);
end;
$$;

create or replace function public.vectis_try_deduct_credits(
  p_organization_id text,
  p_amount int,
  p_reason text
) returns jsonb
language sql
security invoker
set search_path = public, private
as $$
  select private.vectis_try_deduct_credits(p_organization_id, p_amount, p_reason);
$$;

create or replace function private.vectis_increment_rate_limit(
  p_id text,
  p_window_ms int
) returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_count int;
  v_reset_at bigint;
  v_existing_count int;
  v_existing_reset bigint;
begin
  perform pg_advisory_xact_lock(hashtext('vectis_ratelimit:' || p_id));

  select (data->>'count')::int, (data->>'resetAt')::bigint
  into v_existing_count, v_existing_reset
  from public.vectis_collections
  where collection_name = 'rateLimits' and id = p_id;

  if v_existing_count is not null and v_existing_reset > v_now_ms then
    v_count := v_existing_count + 1;
    v_reset_at := v_existing_reset;
  else
    v_count := 1;
    v_reset_at := v_now_ms + p_window_ms;
  end if;

  insert into public.vectis_collections (collection_name, id, data, created_at, updated_at)
  values (
    'rateLimits',
    p_id,
    jsonb_build_object('id', p_id, 'count', v_count, 'resetAt', v_reset_at),
    to_timestamp(v_now_ms / 1000.0),
    to_timestamp(v_now_ms / 1000.0)
  )
  on conflict (id, collection_name) do update set
    data = excluded.data,
    updated_at = excluded.updated_at;

  return jsonb_build_object('count', v_count, 'resetAt', v_reset_at);
end;
$$;

create or replace function public.vectis_increment_rate_limit(
  p_id text,
  p_window_ms int
) returns jsonb
language sql
security invoker
set search_path = public, private
as $$
  select private.vectis_increment_rate_limit(p_id, p_window_ms);
$$;

revoke all on function private.vectis_try_deduct_credits(text, int, text) from public;
grant execute on function private.vectis_try_deduct_credits(text, int, text) to service_role;
revoke all on function public.vectis_try_deduct_credits(text, int, text) from public;
grant execute on function public.vectis_try_deduct_credits(text, int, text) to service_role;

revoke all on function private.vectis_increment_rate_limit(text, int) from public;
grant execute on function private.vectis_increment_rate_limit(text, int) to service_role;
revoke all on function public.vectis_increment_rate_limit(text, int) from public;
grant execute on function public.vectis_increment_rate_limit(text, int) to service_role;

create or replace function private.vectis_get_credit_balance(
  p_organization_id text
) returns bigint
language sql
security definer
set search_path = public, private
stable
as $$
  select coalesce((
    select balance
    from private.vectis_credit_balances
    where organization_id = p_organization_id
  ), 0);
$$;

create or replace function public.vectis_get_credit_balance(
  p_organization_id text
) returns bigint
language sql
security invoker
set search_path = public, private
stable
as $$
  select private.vectis_get_credit_balance(p_organization_id);
$$;

revoke all on function private.vectis_get_credit_balance(text) from public;
grant execute on function private.vectis_get_credit_balance(text) to service_role;
revoke all on function public.vectis_get_credit_balance(text) from public;
grant execute on function public.vectis_get_credit_balance(text) to service_role;
