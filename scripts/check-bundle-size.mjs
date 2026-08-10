#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assetsDir = resolve(root, "apps/web/dist/assets");
const kib = 1024;
const budgets = {
  entryJavaScript: Number(process.env.BUNDLE_ENTRY_JS_MAX_KIB ?? 540) * kib,
  totalJavaScript: Number(process.env.BUNDLE_TOTAL_JS_MAX_KIB ?? 1200) * kib,
  totalCss: Number(process.env.BUNDLE_TOTAL_CSS_MAX_KIB ?? 380) * kib
};

function format(bytes) {
  return `${(bytes / kib).toFixed(1)} KiB`;
}

const files = readdirSync(assetsDir).map((name) => ({
  name,
  bytes: statSync(resolve(assetsDir, name)).size
}));
const javascript = files.filter((file) => file.name.endsWith(".js"));
const css = files.filter((file) => file.name.endsWith(".css"));
const entry = javascript
  .filter((file) => /^index-[A-Za-z0-9_-]+\.js$/.test(file.name))
  .sort((left, right) => right.bytes - left.bytes)[0];

if (!entry) {
  throw new Error("Could not find the built web entry JavaScript bundle.");
}

const measurements = [
  { label: "entry JavaScript", bytes: entry.bytes, max: budgets.entryJavaScript },
  { label: "total JavaScript", bytes: javascript.reduce((sum, file) => sum + file.bytes, 0), max: budgets.totalJavaScript },
  { label: "total CSS", bytes: css.reduce((sum, file) => sum + file.bytes, 0), max: budgets.totalCss }
];

let failed = false;
for (const measurement of measurements) {
  const ok = measurement.bytes <= measurement.max;
  console.log(`${ok ? "PASS" : "FAIL"} ${measurement.label}: ${format(measurement.bytes)} / ${format(measurement.max)}`);
  failed ||= !ok;
}

if (failed) {
  console.error("Bundle budget exceeded. Split or remove shipped code before increasing a budget.");
  process.exit(1);
}
