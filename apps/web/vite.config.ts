import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import fs from "node:fs";

function getDevHeaders() {
  const headers: Record<string, string> = {};
  try {
    const headersPath = resolve(__dirname, "public/_headers");
    if (fs.existsSync(headersPath)) {
      const content = fs.readFileSync(headersPath, "utf-8");
      const lines = content.split(/\r?\n/);
      let isWildcardSection = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "/*") {
          isWildcardSection = true;
          continue;
        }
        if (isWildcardSection) {
          if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
          }
          if (trimmed.startsWith("/")) {
            isWildcardSection = false;
            continue;
          }
          const colonIndex = trimmed.indexOf(":");
          if (colonIndex > 0) {
            const key = trimmed.slice(0, colonIndex).trim();
            let val = trimmed.slice(colonIndex + 1).trim();
            if (key.toLowerCase() === "content-security-policy") {
              val = val.replace(/script-src\s+([^;]+)/, (match, p1) => {
                const parts = p1.split(/\s+/).filter(part => !part.startsWith("'sha256-"));
                if (!parts.includes("'unsafe-inline'")) {
                  parts.unshift("'unsafe-inline'");
                }
                return `script-src ${parts.join(" ")}`;
              });
            }
            headers[key] = val;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load dev headers from public/_headers:", err);
  }
  return headers;
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: getDevHeaders(),
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      },
      "/ws": {
        target: "ws://127.0.0.1:8787",
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, "")
      }
    }
  }
});
