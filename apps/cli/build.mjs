import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  external: [
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/client/*",
    "@napi-rs/keyring",
    "chalk",
    "commander",
    "ink",
    "ink-text-input",
    "react",
    "react/jsx-runtime",
    "zod"
  ]
});
