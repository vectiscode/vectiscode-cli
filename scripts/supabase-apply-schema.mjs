#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const { Client } = pg;

const databaseUrl = process.env.SUPABASE_DB_URL;
const schemaFile = resolve(process.env.SUPABASE_SCHEMA_FILE || "supabase/schema.sql");

if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set. Use the pooled or direct Postgres connection string from Supabase Project Settings.");
  process.exit(1);
}

const sql = readFileSync(schemaFile, "utf8");
const client = new Client({
  connectionString: databaseUrl,
  ssl: process.env.SUPABASE_DB_SSL === "false" ? undefined : { rejectUnauthorized: false }
});

try {
  await client.connect();
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  await client.query("notify pgrst, 'reload schema'");

  const table = await client.query("select to_regclass('public.vectis_collections') as table_name");
  const bucket = await client.query("select id, public, file_size_limit from storage.buckets where id = 'vectis-attachments'");
  const indexes = await client.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'vectis_collections'
    order by indexname
  `);
  const creditBalanceTable = await client.query(`
    select c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relname = 'vectis_credit_balances'
  `);
  const creditFunctions = await client.query(`
    select
      to_regprocedure('public.vectis_try_deduct_credits(text,integer,text)') as deduct_function,
      to_regprocedure('public.vectis_get_credit_balance(text)') as balance_function
  `);
  const creditBalanceMismatches = await client.query(`
    with ledger_balances as (
      select data->>'organizationId' as organization_id, sum((data->>'delta')::bigint) as balance
      from public.vectis_collections
      where collection_name = 'ledger'
        and nullif(data->>'organizationId', '') is not null
        and coalesce(data->>'delta', '') ~ '^-?[0-9]+$'
      group by data->>'organizationId'
    )
    select count(*)::int as mismatch_count
    from ledger_balances ledger
    full join private.vectis_credit_balances cached using (organization_id)
    where coalesce(ledger.balance, 0) <> coalesce(cached.balance, 0)
  `);

  if (!table.rows[0]?.table_name) throw new Error("vectis_collections table was not created.");
  if (!bucket.rows[0]) throw new Error("vectis-attachments bucket was not created.");
  if (!creditBalanceTable.rows[0]?.rls_enabled) throw new Error("vectis_credit_balances is missing or RLS is disabled.");
  if (!creditFunctions.rows[0]?.deduct_function || !creditFunctions.rows[0]?.balance_function) {
    throw new Error("Credit balance RPC functions were not created.");
  }
  if (creditBalanceMismatches.rows[0]?.mismatch_count !== 0) {
    throw new Error(`Materialized credit balances do not match the ledger (${creditBalanceMismatches.rows[0]?.mismatch_count} mismatches).`);
  }

  console.log("Supabase schema applied and verified.");
  console.log(`bucket_public=${bucket.rows[0].public}`);
  console.log(`bucket_file_size_limit=${bucket.rows[0].file_size_limit}`);
  console.log(`indexes=${indexes.rows.map((row) => row.indexname).join(",")}`);
  console.log("credit_balance_cache=verified");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
