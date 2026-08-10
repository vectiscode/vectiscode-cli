#!/usr/bin/env node
/**
 * find-user.mjs - One-off admin lookup for a Vectis Code user.
 *
 * Usage:
 *   node scripts/find-user.mjs <email>
 *
 * Queries the live Supabase project for the user, their org, projects,
 * recent messages, and any captured signup metadata.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 */
import { loadEnv } from "./load-env.mjs";
loadEnv({ quiet: true });

const email = (process.argv[2] || "").toLowerCase().trim();
if (!email) {
  console.error("Usage: node scripts/find-user.mjs <email>");
  process.exit(1);
}

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

async function rpc(path, init = {}) {
  const url = `${supabaseUrl}/rest/v1${path}`;
  const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    console.error(`[${res.status}] ${path}`);
    console.error(typeof body === "string" ? body : JSON.stringify(body, null, 2));
    throw new Error(`Request failed: ${res.status}`);
  }
  return body;
}

console.log(`\n=== Lookup: ${email} ===\n`);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

console.log("[1] Supabase Auth (GoTrue admin)");
let authUsers = [];
try {
  const url = `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const body = await res.json();
  if (!res.ok) {
    console.log(`  -> admin endpoint returned ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  } else {
    authUsers = body?.users || [];
  }
} catch (e) {
  console.log(`  -> admin lookup error: ${e.message}`);
}
if (!authUsers.length) {
  console.log("  -> no Supabase auth user found for that email");
} else {
  for (const u of authUsers) {
    console.log(`  id:             ${u.id}`);
    console.log(`  email:          ${u.email}`);
    console.log(`  phone:          ${u.phone || "(none)"}`);
    console.log(`  role:           ${u.role || "(none)"}`);
    console.log(`  created_at:     ${u.created_at}`);
    console.log(`  updated_at:     ${u.updated_at}`);
    console.log(`  last_sign_in:   ${u.last_sign_in_at || "(never)"}`);
    console.log(`  email_confirmed:${u.email_confirmed_at || "(no)"}`);
    if (u.app_metadata) {
      console.log(`  app_metadata:   ${JSON.stringify(u.app_metadata)}`);
    }
    if (u.user_metadata) {
      console.log(`  user_metadata:  ${JSON.stringify(u.user_metadata)}`);
    }
    if (Array.isArray(u.identities) && u.identities.length) {
      for (const ident of u.identities) {
        console.log(`  identity:       provider=${ident.provider} provider_id=${ident.provider_id} created_at=${ident.created_at}`);
        if (ident.identity_data) {
          console.log(`    identity_data: ${JSON.stringify(ident.identity_data)}`);
        }
      }
    }
  }
}

console.log("\n[2] public schema tables (to find app-level user store)");
let tables = [];
try {
  const t = await rpc(`/information_schema.tables?table_schema=eq.public&table_type=eq.BASE%20TABLE&select=table_name`);
  tables = (t || []).map((r) => r.table_name).filter(Boolean);
  console.log(`  -> ${tables.length} tables in public schema`);
} catch (e) {
  console.log(`  -> schema lookup failed: ${e.message}`);
}
if (tables.length) {
  console.log(`  tables: ${tables.join(", ")}`);
  const userLike = tables.filter((n) => /user|profile|account|member|org|project|stripe|subscription|workspace/i.test(n));
  if (userLike.length) console.log(`  candidate tables: ${userLike.join(", ")}`);
}

console.log("\n[3] public.users (app-level profile, if it exists)");
let appUsers = [];
if (tables.includes("users")) {
  try {
    appUsers = await rpc(`/users?select=*&email=ilike.${encodeURIComponent(email)}&limit=10`);
  } catch (e) {
    console.log("  -> query failed");
  }
}
if (!appUsers || !appUsers.length) {
  console.log("  -> no public.users row found for that email");
} else {
  for (const u of appUsers) {
    console.log(`  id:        ${u.id}`);
    console.log(`  name:      ${u.name}`);
    console.log(`  email:     ${u.email}`);
    console.log(`  provider:  ${u.authProvider || u.auth_provider || "(none)"}`);
    console.log(`  created:   ${u.createdAt || u.created_at}`);
    console.log(`  raw:       ${JSON.stringify(u)}`);
  }
}

const userId = authUsers[0]?.id || appUsers[0]?.id;
if (userId) {
  console.log(`\n[3] memberships for user ${userId}`);
  try {
    const members = await rpc(`/members?select=*&userId=eq.${encodeURIComponent(userId)}&limit=20`);
    if (members?.length) {
      for (const m of members) {
        console.log(`  org:   ${m.organizationId}  role: ${m.role}  joined: ${m.joinedAt || m.created_at || "(unknown)"}`);
      }
    } else {
      console.log("  -> no memberships");
    }
  } catch {
    console.log("  -> no members table or row");
  }

  console.log(`\n[4] projects owned by user ${userId}`);
  try {
    const projs = await rpc(`/projects?select=id,name,template,createdAt,updatedAt&ownerId=eq.${encodeURIComponent(userId)}&order=createdAt.desc&limit=20`);
    if (projs?.length) {
      for (const p of projs) {
        console.log(`  ${p.id}  name=${p.name}  template=${p.template}  created=${p.createdAt}`);
      }
    } else {
      console.log("  -> no projects");
    }
  } catch {
    console.log("  -> no projects table or row");
  }

  console.log(`\n[5] recent messages by user ${userId}`);
  try {
    const msgs = await rpc(`/messages?select=id,role,createdAt,threadId&userId=eq.${encodeURIComponent(userId)}&order=createdAt.desc&limit=10`);
    if (msgs?.length) {
      for (const m of msgs) {
        console.log(`  ${m.createdAt}  role=${m.role}  thread=${m.threadId}`);
      }
    } else {
      console.log("  -> no messages");
    }
  } catch {
    console.log("  -> no messages table or row");
  }

  console.log(`\n[6] credit ledger entries for user ${userId}`);
  try {
    const ledger = await rpc(`/ledger?select=id,deltaCredits,reason,createdAt&userId=eq.${encodeURIComponent(userId)}&order=createdAt.desc&limit=20`);
    if (ledger?.length) {
      for (const l of ledger) {
        console.log(`  ${l.createdAt}  delta=${l.deltaCredits}  reason=${l.reason}`);
      }
    } else {
      console.log("  -> no ledger entries");
    }
  } catch {
    console.log("  -> no ledger table or row");
  }

  console.log(`\n[7] Stripe customer by email ${email}`);
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    try {
      const sc = await fetch(`https://api.stripe.com/v1/customers/search?query=${encodeURIComponent(`email:'${email}'`)}`, {
        headers: { Authorization: `Bearer ${stripeKey}` }
      });
      const sj = await sc.json();
      if (sj?.data?.length) {
        for (const c of sj.data) {
          console.log(`  customer: ${c.id}  name=${c.name}  created=${c.created}  balance=${c.balance}  currency=${c.currency}`);
          if (c.subscriptions?.data?.length) {
            for (const s of c.subscriptions.data) {
              console.log(`    subscription: ${s.id}  status=${s.status}  price=${s.items?.data?.[0]?.price?.id}`);
            }
          }
        }
      } else {
        console.log("  -> no Stripe customer");
      }
    } catch (e) {
      console.log("  -> Stripe lookup failed");
    }
  } else {
    console.log("  -> STRIPE_SECRET_KEY not set; skipping");
  }
}

console.log("\n=== done ===\n");
