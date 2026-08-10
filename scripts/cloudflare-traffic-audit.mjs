const DEFAULT_SITE = "https://vectiscode.com";
const DEFAULT_API = "https://api.vectiscode.com";
const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

const env = process.env;
const siteBase = stripTrailingSlash(env.TRAFFIC_AUDIT_SITE || DEFAULT_SITE);
const apiBase = stripTrailingSlash(env.TRAFFIC_AUDIT_API || DEFAULT_API);
const hours = Number.parseInt(env.TRAFFIC_AUDIT_HOURS || "48", 10);
const cloudflareToken = env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || "";
const cloudflareZoneId = env.CLOUDFLARE_ZONE_ID || env.CF_ZONE_ID || "";
const browserHeaders = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 VectisTrafficAudit/1.0"
};

const now = new Date();
const start = new Date(now.getTime() - Math.max(hours, 1) * 60 * 60 * 1000);

const auditUrls = [
  `${siteBase}/`,
  `${siteBase}/download`,
  `${siteBase}/robots.txt`,
  `${siteBase}/sitemap.xml`,
  `${siteBase}/llms.txt`,
  `${siteBase}/images/logo-512.webp`,
  `${apiBase}/`,
  `${apiBase}/health`,
  `${apiBase}/auth/config`
];

const report = {
  generatedAt: now.toISOString(),
  window: {
    hours,
    start: start.toISOString(),
    end: now.toISOString()
  },
  inputs: {
    siteBase,
    apiBase,
    cloudflareCredentialsPresent: Boolean(cloudflareToken && cloudflareZoneId)
  },
  publicChecks: [],
  homepageSignals: {},
  robots: {},
  sitemap: {},
  cloudflare: null,
  findings: []
};

for (const url of auditUrls) {
  report.publicChecks.push(await checkUrl(url));
}

const homepage = await getText(`${siteBase}/`);
report.homepageSignals = inspectHomepage(homepage.text);

const robots = await getText(`${siteBase}/robots.txt`);
report.robots = inspectRobots(robots.text);

const sitemap = await getText(`${siteBase}/sitemap.xml`);
report.sitemap = inspectSitemap(sitemap.text);

report.findings.push(...buildPublicFindings(report));

if (cloudflareToken && cloudflareZoneId) {
  report.cloudflare = await runCloudflareAudit();
  report.findings.push(...buildCloudflareFindings(report.cloudflare));
} else {
  report.cloudflare = {
    skipped: true,
    reason: "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to include account-level request breakdowns."
  };
}

printReport(report);

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

async function checkUrl(url) {
  const started = Date.now();
  let response;
  let method = "HEAD";
  try {
    response = await fetch(url, { method, headers: browserHeaders, redirect: "manual" });
  } catch (error) {
    method = "GET";
    try {
      response = await fetch(url, { method, headers: browserHeaders, redirect: "manual" });
    } catch (fallbackError) {
      return {
        url,
        ok: false,
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        durationMs: Date.now() - started
      };
    }
  }

  return {
    url,
    method,
    ok: response.ok,
    status: response.status,
    durationMs: Date.now() - started,
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    cfCacheStatus: response.headers.get("cf-cache-status") || "",
    age: response.headers.get("age") || "",
    server: response.headers.get("server") || "",
    contentLength: response.headers.get("content-length") || ""
  };
}

async function getText(url) {
  try {
    const response = await fetch(url, { headers: browserHeaders, redirect: "manual" });
    return {
      url,
      ok: response.ok,
      status: response.status,
      text: await response.text()
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      text: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function inspectHomepage(html) {
  return {
    cloudflareWebAnalytics: html.includes("static.cloudflareinsights.com/beacon.min.js"),
    rocketLoader: html.includes("rocket-loader.min.js"),
    rocketLoaderRewritesModuleScript: /type="[^"]*-module"/.test(html),
    preloadsLogo512: html.includes('href="/images/logo-512.webp"') && html.includes('rel="preload"'),
    appScripts: [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]),
    stylesheets: [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1])
  };
}

function inspectRobots(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    present: Boolean(text.trim()),
    disallow: lines.filter((line) => /^disallow:/i.test(line)).map((line) => line.replace(/^disallow:\s*/i, "")),
    allow: lines.filter((line) => /^allow:/i.test(line)).map((line) => line.replace(/^allow:\s*/i, "")),
    sitemap: lines.filter((line) => /^sitemap:/i.test(line)).map((line) => line.replace(/^sitemap:\s*/i, "")),
    hasContentSignal: lines.some((line) => /^content-signal:/i.test(line)),
    explicitlyBlocksAiTrainingBots: /(GPTBot|ClaudeBot|Bytespider|CCBot|Google-Extended|Applebot-Extended)/i.test(text)
  };
}

function inspectSitemap(text) {
  const urls = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  return {
    present: Boolean(text.trim()),
    urlCount: urls.length,
    urls
  };
}

function buildPublicFindings(data) {
  const findings = [];
  const logo = data.publicChecks.find((check) => check.url.endsWith("/images/logo-512.webp"));
  const appHtml = data.publicChecks.find((check) => check.url === `${siteBase}/`);
  const sitemapCheck = data.publicChecks.find((check) => check.url.endsWith("/sitemap.xml"));
  const apiConfig = data.publicChecks.find((check) => check.url.endsWith("/auth/config"));

  if (data.homepageSignals.cloudflareWebAnalytics) {
    findings.push("Cloudflare Web Analytics is active, so Web Analytics visits are browser/RUM oriented and should stay much lower than edge request totals.");
  }

  if (data.homepageSignals.rocketLoader) {
    findings.push("Rocket Loader is active on the live HTML. Keep it enabled while synthetic and real-user metrics look healthy, but retest if hydration or LCP gets worse.");
  }

  if (logo?.cfCacheStatus) {
    findings.push(`The hero logo cache status is ${logo.cfCacheStatus}. This supports the current read that the LCP issue is long-tail timing rather than an uncached heavy logo.`);
  }

  if (appHtml?.cfCacheStatus === "DYNAMIC") {
    findings.push("HTML is served as dynamic at Cloudflare, which is normal for Pages HTML and keeps deploy freshness high.");
  }

  if (sitemapCheck?.ok && data.sitemap.urlCount > 0) {
    findings.push(`The sitemap exposes ${data.sitemap.urlCount} public URL(s), so crawler discovery is expected even without advertising.`);
  }

  if (apiConfig?.ok && apiConfig.cfCacheStatus === "DYNAMIC") {
    findings.push("The public auth config endpoint is reachable and dynamic, which is expected for runtime app configuration.");
  }

  if (!data.robots.explicitlyBlocksAiTrainingBots) {
    findings.push("robots.txt does not explicitly block named AI training crawlers. This matches the current audit-only posture.");
  }

  return findings;
}

function buildCloudflareFindings(data) {
  if (!data || data.skipped) return [];
  const findings = [];
  const status4xx = data.statusClasses?.find((row) => row.statusClass === "4xx");
  const status5xx = data.statusClasses?.find((row) => row.statusClass === "5xx");
  const topUnknown = data.topPaths?.find((row) => row.path && !isKnownProductPath(row.path));

  if (status4xx) findings.push(`Cloudflare reported ${status4xx.requests} request(s) in the 4xx class for the selected window.`);
  if (status5xx) findings.push(`Cloudflare reported ${status5xx.requests} request(s) in the 5xx class for the selected window.`);
  if (topUnknown) findings.push(`The top unknown path is ${topUnknown.path} with ${topUnknown.requests} request(s). Check whether it is a scanner, stale asset, or missing route.`);

  return findings;
}

function isKnownProductPath(path) {
  return path === "/" ||
    path === "/download" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml" ||
    path === "/llms.txt" ||
    path.startsWith("/assets/") ||
    path.startsWith("/images/") ||
    path.startsWith("/api/") ||
    path.startsWith("/cdn-cgi/") ||
    path.startsWith("/legal/");
}

async function runCloudflareAudit() {
  const query = `
    query TrafficAudit($zoneTag: string, $start: Time, $end: Time) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          totals: httpRequestsAdaptiveGroups(
            limit: 1
            filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball" }
          ) {
            count
            sum { edgeResponseBytes visits }
          }
          topPaths: httpRequestsAdaptiveGroups(
            limit: 20
            orderBy: [count_DESC]
            filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball" }
          ) {
            count
            sum { edgeResponseBytes visits }
            dimensions { clientRequestPath clientRequestHTTPHost edgeResponseStatus cacheStatus clientCountryName userAgent }
          }
          errors4xx: httpRequestsAdaptiveGroups(
            limit: 20
            orderBy: [count_DESC]
            filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball", edgeResponseStatus_geq: 400, edgeResponseStatus_lt: 500 }
          ) {
            count
            dimensions { clientRequestPath clientRequestHTTPHost edgeResponseStatus clientCountryName userAgent }
          }
          errors5xx: httpRequestsAdaptiveGroups(
            limit: 20
            orderBy: [count_DESC]
            filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball", edgeResponseStatus_geq: 500, edgeResponseStatus_lt: 600 }
          ) {
            count
            dimensions { clientRequestPath clientRequestHTTPHost edgeResponseStatus clientCountryName userAgent }
          }
        }
      }
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${cloudflareToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query,
      variables: {
        zoneTag: cloudflareZoneId,
        start: start.toISOString(),
        end: now.toISOString()
      }
    })
  });

  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    return {
      ok: false,
      status: response.status,
      errors: body.errors || body
    };
  }

  const zone = body.data?.viewer?.zones?.[0];
  if (!zone) {
    return {
      ok: false,
      errors: ["No Cloudflare zone returned. Check CLOUDFLARE_ZONE_ID."]
    };
  }

  const topPaths = zone.topPaths.map((row) => ({
    path: row.dimensions.clientRequestPath,
    host: row.dimensions.clientRequestHTTPHost,
    status: row.dimensions.edgeResponseStatus,
    cacheStatus: row.dimensions.cacheStatus,
    country: row.dimensions.clientCountryName,
    userAgent: row.dimensions.userAgent,
    requests: row.count,
    bytes: row.sum.edgeResponseBytes,
    visits: row.sum.visits
  }));

  const errors4xx = zone.errors4xx.map(toErrorRow);
  const errors5xx = zone.errors5xx.map(toErrorRow);

  return {
    ok: true,
    totals: {
      requests: zone.totals?.[0]?.count || 0,
      bytes: zone.totals?.[0]?.sum?.edgeResponseBytes || 0,
      visits: zone.totals?.[0]?.sum?.visits || 0
    },
    topPaths,
    errors4xx,
    errors5xx,
    statusClasses: [
      { statusClass: "4xx", requests: errors4xx.reduce((sum, row) => sum + row.requests, 0) },
      { statusClass: "5xx", requests: errors5xx.reduce((sum, row) => sum + row.requests, 0) }
    ]
  };
}

function toErrorRow(row) {
  return {
    path: row.dimensions.clientRequestPath,
    host: row.dimensions.clientRequestHTTPHost,
    status: row.dimensions.edgeResponseStatus,
    country: row.dimensions.clientCountryName,
    userAgent: row.dimensions.userAgent,
    requests: row.count
  };
}

function printReport(data) {
  console.log(JSON.stringify(data, null, 2));
}
