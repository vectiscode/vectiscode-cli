#!/usr/bin/env node
/**
 * search-vectis-users.mjs - Search vectis_collections for users by email or name.
 *
 * The admin panel reads from `vectis_collections` (collection_name='users'),
 * not from auth.users. This script queries that table directly.
 *
 * Usage: node scripts/search-vectis-users.mjs <email-or-name-substring>
 */
import { loadEnv } from "./load-env.mjs";
loadEnv({ quiet: true });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const want = (process.argv[2] || "").toLowerCase().trim();
if (!want) {
  console.error("usage: node scripts/search-vectis-users.mjs <email-or-name-substring>");
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json"
};

async function getJson(path) {
  const res = await fetch(`${supabaseUrl}${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

console.log(`\n=== Search vectis_collections (collection_name=users) for: "${want}" ===\n`);

const all = [];
let from = 0;
const PAGE = 1000;
while (true) {
  const { ok, status, body } = await getJson(
    `/rest/v1/vectis_collections?select=id,data,created_at&collection_name=eq.users&order=created_at&order=id&offset=${from}&limit=${PAGE}`
  );
  if (!ok) {
    console.error(`page fetch failed ${status}: ${JSON.stringify(body).slice(0, 300)}`);
    process.exit(1);
  }
  const rows = body || [];
  all.push(...rows);
  if (rows.length < PAGE) break;
  from += PAGE;
  if (from > 20_000) {
    console.error("refusing to paginate past 20k rows");
    break;
  }
}

console.log(`total user documents: ${all.length}\n`);

const hits = all.filter((row) => {
  const d = row.data || {};
  return (
    (d.email || "").toLowerCase().includes(want) ||
    (d.displayName || "").toLowerCase().includes(want) ||
    (d.name || "").toLowerCase().includes(want) ||
    (d.fullName || "").toLowerCase().includes(want) ||
    (d.googleUserId || "").toLowerCase().includes(want) ||
    (d.id || "").toLowerCase().includes(want)
  );
});

if (!hits.length) {
  console.log("no matches in vectis_collections.users");
  console.log("sample emails in the table:");
  for (const row of all.slice(0, 20)) {
    const d = row.data || {};
    console.log(`  - ${d.email || "(no email)"}  id=${d.id}  created=${row.created_at}  name=${d.displayName || d.name || d.fullName || ""}`);
  }
} else {
  console.log(`matches: ${hits.length}\n`);
  for (const row of hits) {
    const d = row.data || {};
    console.log(`id:          ${d.id || row.id}`);
    console.log(`email:       ${d.email || "(none)"}`);
    console.log(`displayName: ${d.displayName || d.name || d.fullName || "(none)"}`);
    console.log(`authProvider:${d.authProvider || "(none)"}`);
    console.log(`googleUserId:${d.googleUserId || d.googleUserIds?.[0] || "(none)"}`);
    console.log(`robloxUserId:${d.robloxUserId || "(none)"}`);
    console.log(`status:      ${d.status || "(active)"}`);
    console.log(`createdAt:   ${d.createdAt}`);
    console.log(`updatedAt:   ${d.updatedAt}`);
    console.log(`lastSeenAt:  ${d.lastSeenAt || "(none)"}`);
    console.log("");
  }
}
