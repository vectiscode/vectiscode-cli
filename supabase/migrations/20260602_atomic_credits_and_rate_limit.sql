-- Migration: 2026-06-02 Atomic credit deduction and rate limiting
-- This migration adds pgcrypto, atomic credit deduction, atomic rate limiting,
-- and a unique index on stripeEventId. All statements are idempotent.
--
-- Applied automatically on API startup via supabase/schema.sql.
-- This file serves as an audit trail of what changed and when.

-- 1. Enable pgcrypto for gen_random_uuid()
create extension if not exists pgcrypto;

-- 1b. Private helper schema for privileged RPC implementations
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to service_role;

-- 2. Unique index on stripeProcessedEvents.stripeEventId (prevents duplicate webhook processing)
-- Keep the newest historical marker if old duplicate rows already exist.
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
    and data->>'stripeEventId' is not null
    and data->>'stripeEventId' <> '';

-- 3. Atomic credit deduction function
-- Uses pg_advisory_xact_lock to serialize per-org ledger writes.
-- Returns {ok: boolean, balance: bigint} as jsonb.
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
  if p_amount <= 0 then
    v_balance := coalesce((
      select sum((data->>'delta')::bigint)
      from public.vectis_collections
      where collection_name = 'ledger'
        and data->>'organizationId' = p_organization_id
    ), 0);
    return jsonb_build_object('ok', true, 'balance', v_balance);
  end if;

  perform pg_advisory_xact_lock(hashtext('vectis_deduct:' || p_organization_id));

  select coalesce(sum((data->>'delta')::bigint), 0)
  into v_balance
  from public.vectis_collections
  where collection_name = 'ledger'
    and data->>'organizationId' = p_organization_id;

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

-- 4. Atomic rate limit function
-- Uses pg_advisory_xact_lock to serialize per-key rate limit increments.
-- Returns {count: bigint, resetAt: bigint} as jsonb.
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

-- 5. Revoke from public, grant to service_role only
revoke all on function private.vectis_try_deduct_credits(text, int, text) from public;
grant execute on function private.vectis_try_deduct_credits(text, int, text) to service_role;
revoke all on function public.vectis_try_deduct_credits(text, int, text) from public;
grant execute on function public.vectis_try_deduct_credits(text, int, text) to service_role;

revoke all on function private.vectis_increment_rate_limit(text, int) from public;
grant execute on function private.vectis_increment_rate_limit(text, int) to service_role;
revoke all on function public.vectis_increment_rate_limit(text, int) from public;
grant execute on function public.vectis_increment_rate_limit(text, int) to service_role;

-- 6. Credit balance RPC (avoids fetching all ledger entries)
create or replace function private.vectis_get_credit_balance(
  p_organization_id text
) returns bigint
language sql
security definer
set search_path = public, private
stable
as $$
  select coalesce(sum((data->>'delta')::bigint), 0)
  from public.vectis_collections
  where collection_name = 'ledger'
    and data->>'organizationId' = p_organization_id;
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
