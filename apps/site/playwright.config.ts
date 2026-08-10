import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "npm run dev:api:test",
      cwd: repoRoot,
      url: "http://127.0.0.1:8787/auth/config",
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: "npm run dev -w apps/web -- --host 127.0.0.1 --port 5173",
      cwd: repoRoot,
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 30_000
    }
  ],
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } }
    }
  ]
});
