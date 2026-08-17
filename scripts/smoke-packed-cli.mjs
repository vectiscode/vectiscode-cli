import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const files = fs.readdirSync(root);
const tarballs = files
  .filter((f) => f.startsWith("vectiscode-") && f.endsWith(".tgz"))
  .map((f) => ({ name: f, time: fs.statSync(path.join(root, f)).mtimeMs }))
  .sort((a, b) => b.time - a.time);

if (!tarballs.length) {
  console.error("No vectiscode-*.tgz tarball found in workspace root. Run npm run pack:cli first.");
  process.exit(1);
}

const tarball = tarballs[0].name;
const tarballPath = path.resolve(root, tarball);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vectiscode-smoke-"));

// Initialize minimal package.json in tmpDir to ensure clean install prefix
fs.writeFileSync(
  path.join(tmpDir, "package.json"),
  JSON.stringify({ name: "vectiscode-smoke-test", private: true }, null, 2)
);

try {
  console.log(`[smoke-cli] Installing ${tarball} into isolated prefix: ${tmpDir}`);
  const isWin = process.platform === "win32";

  // Use execSync with properly quoted paths to avoid space splitting
  execSync(`npm install --ignore-scripts "${tarballPath}"`, {
    cwd: tmpDir,
    stdio: "inherit"
  });

  const binName = isWin ? "vectiscode.cmd" : "vectiscode";
  const binPath = path.join(tmpDir, "node_modules", ".bin", binName);

  console.log(`[smoke-cli] Testing binary --help: ${binPath}`);
  const helpOutput = execSync(`"${binPath}" --help`, {
    cwd: tmpDir,
    encoding: "utf8"
  });
  if (!helpOutput.includes("vectiscode")) {
    throw new Error(`Unexpected --help output: ${helpOutput}`);
  }

  console.log(`[smoke-cli] Testing binary doctor: ${binPath}`);
  const doctorOutput = execSync(`"${binPath}" doctor`, {
    cwd: tmpDir,
    encoding: "utf8"
  });
  if (!doctorOutput.includes("VectisCode doctor") && !doctorOutput.includes("doctor")) {
    throw new Error(`Unexpected doctor output: ${doctorOutput}`);
  }

  console.log("[smoke-cli] PASS: Packed CLI installs and executes cleanly.");
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error in tmp dir
  }
}
