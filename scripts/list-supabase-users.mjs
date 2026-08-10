#!/usr/bin/env node
/**
 * list-supabase-users.mjs - List every user in the Supabase auth.users table.
 *
 * Usage: node scripts/list-supabase-users.mjs
 */
import { loadEnv } from "./load-env.mjs";
loadEnv({ quiet: true });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

let page = 1;
const perPage = 50;
let total = 0;
let allUsers = [];

while (true) {
  const url = `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`page ${page} failed: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    process.exit(1);
  }
  const users = body?.users || [];
  allUsers = allUsers.concat(users);
  total += users.length;
  if (users.length < perPage) break;
  page += 1;
  if (page > 20) break;
}

console.log(`\n=== ${allUsers.length} user(s) in Supabase auth.users ===\n`);
for (const u of allUsers) {
  const name = u.user_metadata?.full_name || u.user_metadata?.name || u.user_metadata?.display_name || "(no name)";
  const provider = u.app_metadata?.provider || "?";
  console.log(`${u.email}`);
  console.log(`  id:        ${u.id}`);
  console.log(`  name:      ${name}`);
  console.log(`  provider:  ${provider}`);
  console.log(`  created:   ${u.created_at}`);
  console.log(`  last_sign: ${u.last_sign_in_at || "(never)"}`);
  if (u.user_metadata?.iss) console.log(`  iss:       ${u.user_metadata.iss}`);
  if (u.user_metadata?.sub) console.log(`  sub:       ${u.user_metadata.sub}`);
  if (u.user_metadata?.picture) console.log(`  picture:   ${u.user_metadata.picture}`);
  console.log("");
}

const want = (process.argv[2] || "").toLowerCase().trim();
if (want) {
  const hits = allUsers.filter((u) =>
    (u.email || "").toLowerCase().includes(want) ||
    (u.user_metadata?.full_name || "").toLowerCase().includes(want) ||
    (u.user_metadata?.name || "").toLowerCase().includes(want)
  );
  console.log(`=== search "${want}" ===`);
  if (!hits.length) {
    console.log("  -> no matches");
  } else {
    for (const u of hits) {
      const name = u.user_metadata?.full_name || u.user_metadata?.name || "(no name)";
      console.log(`  ${u.email}  name=${name}  id=${u.id}`);
    }
  }
  console.log("");
}
