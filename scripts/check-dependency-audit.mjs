#!/usr/bin/env node
import { execSync } from "node:child_process";

const acceptedHighRisk = new Map([
  ["undici", {
    path: "discord.js@14.26.4 -> undici@6.24.1",
    reason: "discord.js pins the affected version exactly and currently has no compatible patched 14.x release.",
    reviewBy: "2026-07-15"
  }]
]);

let auditOutput;
try {
  auditOutput = execSync("npm audit --omit=dev --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (err) {
  // npm audit exits non-zero when vulnerabilities are found; stdout still contains JSON
  auditOutput = err.stdout ?? "";
  if (!auditOutput) {
    console.error(`FAIL npm audit did not return JSON: ${(err.stderr ?? err.message ?? "unknown error").trim()}`);
    process.exit(1);
  }
}

const report = JSON.parse(auditOutput);
const vulnerabilities = Object.values(report.vulnerabilities ?? {});
const blocking = vulnerabilities.filter((entry) =>
  (entry.severity === "high" || entry.severity === "critical") && !acceptedHighRisk.has(entry.name)
);

for (const [name, exception] of acceptedHighRisk) {
  const finding = vulnerabilities.find((entry) => entry.name === name);
  if (!finding) continue;
  if (new Date(`${exception.reviewBy}T23:59:59Z`).getTime() < Date.now()) {
    console.error(`FAIL accepted dependency risk expired for ${name} on ${exception.reviewBy}`);
    process.exit(1);
  }
  console.log(`ACCEPTED ${name}: ${exception.path}; review by ${exception.reviewBy}; ${exception.reason}`);
}

if (blocking.length > 0) {
  for (const finding of blocking) console.error(`FAIL ${finding.name}: ${finding.severity}`);
  process.exit(1);
}
console.log(`PASS no unaccepted high or critical dependency advisories (${vulnerabilities.length} total findings)`);
