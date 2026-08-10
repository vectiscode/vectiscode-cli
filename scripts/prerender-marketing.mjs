#!/usr/bin/env node
/**
 * prerender-marketing.mjs - Static prerender the marketing routes.
 *
 * After `vite build`, this spins a tiny static server on a random port,
 * uses Playwright chromium to render the marketing routes, then writes the
 * fully-rendered HTML over the dist/ files so that crawlers (Googlebot,
 * GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) see real content instead
 * of an empty SPA shell.
 *
 * The React app still hydrates on top of the prerendered DOM via createRoot,
 * so app behaviour is unchanged for real users.
 *
 * Routes prerendered: public pages plus /login and /account so direct
 * account entry points work on static hosting before the SPA hydrates.
 *
 * Network calls to api.* are blocked during prerender so the production API
 * is never touched and the page settles deterministically.
 *
 * Skip with: PRERENDER=skip (the build pipeline will pass through unchanged).
 * Run standalone: node scripts/prerender-marketing.mjs
 */
import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.PRERENDER === "skip") {
  console.log("[prerender] PRERENDER=skip set, exiting.");
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "apps/web/dist");

if (!existsSync(distDir)) {
  console.error(`[prerender] Missing build output: ${distDir}. Run vite build first.`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  Static server (matches Cloudflare Pages routing semantics)         */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".lua": "text/x-lua",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8"
};

async function tryServe(filePath) {
  try {
    const info = await stat(filePath);
    if (info.isFile()) return await readFile(filePath);
  } catch {
    return null;
  }
  return null;
}

async function serveRequest(reqUrl) {
  let pathname = decodeURIComponent(reqUrl.split("?")[0] || "/");
  if (pathname.includes("..")) return { status: 400, body: Buffer.from("Bad request"), type: "text/plain" };

  if (pathname.endsWith("/")) {
    const indexBody = await tryServe(join(distDir, pathname, "index.html"));
    if (indexBody) return { status: 200, body: indexBody, type: MIME[".html"] };
  }

  const directBody = await tryServe(join(distDir, pathname));
  if (directBody) {
    return { status: 200, body: directBody, type: MIME[extname(pathname).toLowerCase()] || "application/octet-stream" };
  }

  const htmlBody = await tryServe(join(distDir, `${pathname}.html`));
  if (htmlBody) return { status: 200, body: htmlBody, type: MIME[".html"] };

  const fallback = await tryServe(join(distDir, "index.html"));
  if (fallback) return { status: 200, body: fallback, type: MIME[".html"] };

  return { status: 404, body: Buffer.from("Not found"), type: "text/plain" };
}

function startServer() {
  return new Promise((resolveServer) => {
    const server = createServer(async (req, res) => {
      try {
        const result = await serveRequest(req.url || "/");
        res.writeHead(result.status, { "Content-Type": result.type, "Cache-Control": "no-store" });
        res.end(result.body);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Server error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolveServer({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Prerender                                                          */
/* ------------------------------------------------------------------ */

const ROUTES = [
  { path: "/", outFile: "index.html" },
  { path: "/docs", outFile: "docs.html" },
  { path: "/status", outFile: "status.html" },
  { path: "/download", outFile: "download.html" },
  { path: "/privacy", outFile: "privacy.html" },
  { path: "/terms", outFile: "terms.html" },
  { path: "/login", outFile: "login.html" },
  { path: "/account", outFile: "account.html" }
];

const PRERENDER_MARKER = '<meta name="x-vectis-prerendered" content="1" />';

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    console.warn("[prerender] Playwright unavailable, skipping SSG step.");
    console.warn(`[prerender] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(0);
  }

  const { server, baseUrl } = await startServer();
  console.log(`[prerender] static server listening on ${baseUrl}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: "VectisPrerender/1.0 (compatible; static SSG)",
    viewport: { width: 1280, height: 800 }
  });
  await context.addInitScript(() => {
    window.__PRERENDER__ = true;
  });
  await context.route(/^https?:\/\/api\./i, (route) => route.abort());
  await context.route(/cloudflareinsights|googleapis|gstatic|fonts\.googleapis\.com/i, (route) => route.abort());

  let written = 0;
  let failed = 0;
  for (const route of ROUTES) {
    const page = await context.newPage();
    try {
      const url = `${baseUrl}${route.path}`;
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      if (!response || !response.ok()) {
        throw new Error(`navigation returned ${response ? response.status() : "no response"}`);
      }
      await page.waitForFunction(
        () => {
          const root = document.getElementById("root");
          return !!root && root.children.length > 0 && root.textContent && root.textContent.trim().length > 50;
        },
        { timeout: 15000 }
      );
      await page.waitForTimeout(600);

      await page.evaluate(() => {
        const loader = document.getElementById("initial-loading-screen");
        if (loader) loader.remove();
      });

      let html = await page.content();

      if (!html.startsWith("<!DOCTYPE") && !html.startsWith("<!doctype")) {
        html = `<!doctype html>\n${html}`;
      }
      if (!html.includes("x-vectis-prerendered")) {
        html = html.replace(/<head([^>]*)>/i, (match) => `${match}\n    ${PRERENDER_MARKER}`);
      }

      const outPath = join(distDir, route.outFile);
      await writeFile(outPath, html, "utf8");
      console.log(`[prerender] ${route.path.padEnd(12)} -> ${route.outFile.padEnd(18)} (${html.length.toLocaleString()} bytes)`);
      written++;
    } catch (err) {
      console.error(`[prerender] ${route.path} FAILED: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    } finally {
      await page.close();
    }
  }

  await browser.close();
  await new Promise((done) => server.close(done));

  if (failed > 0) {
    console.error(`[prerender] ${failed} route(s) failed.`);
    process.exit(1);
  }
  console.log(`[prerender] done. ${written}/${ROUTES.length} routes prerendered.`);
}

main().catch((err) => {
  console.error("[prerender] fatal:", err);
  process.exit(1);
});
