import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const command = isWindows ? "npm run start:test -w apps/api" : "npm";
const args = isWindows ? [] : ["run", "start:test", "-w", "apps/api"];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key, value]) => key && !key.includes("=") && value !== undefined)
);
const child = spawn(command, args, {
  stdio: "inherit",
  shell: true,
  env: {
    ...env,
    NODE_ENV: "test",
    ALLOW_PRIVATE_OWNER_LOGIN: "true",
    VECTIS_VISUAL_ADMIN: "true",
    PORT: process.env.PORT || "8787"
  }
});

const stop = () => {
  if (!child.killed) child.kill();
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
