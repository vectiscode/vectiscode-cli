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
  into v_balance;

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
