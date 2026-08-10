#!/usr/bin/env node
/**
 * dump-all-vectis-users.mjs - List every user in the admin panel and any evidence.
 */
import { loadEnv } from "./load-env.mjs";
loadEnv({ quiet: true });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
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

function shape(row) {
  const d = row.data || {};
  return {
    id: d.id,
    email: d.email || "(none)",
    displayName: d.displayName || d.name || d.fullName || "(none)",
    authProvider: d.authProvider || "(none)",
    googleUserId: d.googleUserId || (d.googleUserIds || [])[0] || "(none)",
    robloxUserId: d.robloxUserId || "(none)",
    status: d.status || "active",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    lastSeenAt: d.lastSeenAt || "(none)"
  };
}

const all = [];
let from = 0;
const PAGE = 1000;
while (true) {
  const { ok, body } = await getJson(
    `/rest/v1/vectis_collections?select=id,data,created_at&collection_name=eq.users&order=created_at&order=id&offset=${from}&limit=${PAGE}`
  );
  if (!ok) {
    console.error("fetch failed");
    process.exit(1);
  }
  const rows = body || [];
  all.push(...rows);
  if (rows.length < PAGE) break;
  from += PAGE;
}

const shaped = all.map(shape).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

console.log(`\n=== ${shaped.length} user(s) in vectis_collections.users ===\n`);
for (const u of shaped) {
  console.log(`${u.email}`);
  console.log(`  id:        ${u.id}`);
  console.log(`  name:      ${u.displayName}`);
  console.log(`  provider:  ${u.authProvider}`);
  console.log(`  googleUid: ${u.googleUserId}`);
  console.log(`  robloxUid: ${u.robloxUserId}`);
  console.log(`  status:    ${u.status}`);
  console.log(`  created:   ${u.createdAt}`);
  console.log(`  lastSeen:  ${u.lastSeenAt}`);
  console.log("");
}

console.log(`=== Evidence for Lucas (VCTR-4B5B3NE2TDUH) ===\n`);
const ev = await getJson(
  `/rest/v1/vectis_collections?select=id,data,created_at&collection_name=eq.customerEvidence&order=created_at.desc&limit=50`
);
if (ev.ok) {
  const lucasEv = (ev.body || []).filter((row) => {
    const d = row.data || {};
    return d.userId === "VCTR-4B5B3NE2TDUH" || (d.metadata && d.metadata.userId === "VCTR-4B5B3NE2TDUH");
  });
  if (!lucasEv.length) {
    console.log("  no customerEvidence rows for that userId");
  } else {
    for (const row of lucasEv) {
      const d = row.data;
      console.log(`- ${d.createdAt}  type=${d.type}  action=${d.action}  status=${d.status}`);
      if (d.ip) console.log(`  ip=${d.ip}  country=${d.country || "?"}`);
      if (d.userAgent) console.log(`  ua=${d.userAgent}`);
      if (d.projectId) console.log(`  projectId=${d.projectId}`);
      if (d.threadId) console.log(`  threadId=${d.threadId}`);
      if (d.amountCredits != null) console.log(`  amountCredits=${d.amountCredits}`);
      if (d.metadata) console.log(`  metadata=${JSON.stringify(d.metadata)}`);
    }
  }
}

console.log(`\n=== Projects owned by Lucas ===\n`);
const projects = await getJson(
  `/rest/v1/vectis_collections?select=id,data,created_at&collection_name=eq.projects&order=created_at.desc&limit=200`
);
if (projects.ok) {
  const lucasProjects = (projects.body || []).filter((row) => {
    const d = row.data || {};
    return d.ownerId === "VCTR-4B5B3NE2TDUH" || d.userId === "VCTR-4B5B3NE2TDUH";
  });
  if (!lucasProjects.length) {
    console.log("  no projects owned by Lucas");
  } else {
    for (const row of lucasProjects) {
      const d = row.data;
      console.log(`- ${d.id}  name=${d.name}  template=${d.template}  created=${d.createdAt}`);
    }
  }
}

console.log(`\n=== Memberships (org) for Lucas ===\n`);
const orgs = await getJson(
  `/rest/v1/vectis_collections?select=id,data&collection_name=eq.organizations&limit=200`
);
if (orgs.ok) {
  const lucasOrgs = (orgs.body || []).filter((row) => {
    const d = row.data || {};
    if (d.ownerId === "VCTR-4B5B3NE2TDUH") return true;
    if (Array.isArray(d.members)) {
      return d.members.some((m) => m.userId === "VCTR-4B5B3NE2TDUH");
    }
    return false;
  });
  if (!lucasOrgs.length) {
    console.log("  no organizations linked to Lucas");
  } else {
    for (const row of lucasOrgs) {
      const d = row.data;
      console.log(`- ${d.id}  name=${d.name}  plan=${d.plan}  ownerId=${d.ownerId}  members=${(d.members || []).length}`);
    }
  }
}
