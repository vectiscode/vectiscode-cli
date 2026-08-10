#!/usr/bin/env node
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is not set.");
  process.exit(1);
}

const response = await fetch("https://api.supabase.com/v1/projects", {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/json"
  }
});

if (!response.ok) {
  const detail = await response.text().catch(() => "");
  console.error(`Supabase project list failed: ${response.status} ${detail.slice(0, 300)}`);
  process.exit(1);
}

const projects = await response.json();
if (!Array.isArray(projects) || projects.length === 0) {
  console.log("No Supabase projects found for this token.");
  process.exit(0);
}

for (const project of projects) {
  console.log([
    `name=${project.name ?? "unknown"}`,
    `ref=${project.ref ?? project.id ?? "unknown"}`,
    `status=${project.status ?? "unknown"}`,
    `region=${project.region ?? "unknown"}`,
    `organization=${project.organization_slug ?? project.organization_id ?? "unknown"}`
  ].join(" "));
}
