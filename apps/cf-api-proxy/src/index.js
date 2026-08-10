const UPSTREAM_HOST = "juicy123-vectiscode.hf.space";
const PRODUCTION_ORIGINS = new Set([
  "https://vectiscode.com",
  "https://www.vectiscode.com"
]);

export function isAllowedWebOrigin(origin) {
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.vectiscode\.pages\.dev$/i.test(origin);
}

function appendVary(headers, value) {
  const current = headers.get("Vary");
  const values = new Set((current || "").split(",").map((item) => item.trim()).filter(Boolean));
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

export function corsHeadersFor(request) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedWebOrigin(origin)) return undefined;

  const headers = new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true"
  });
  appendVary(headers, "Origin");
  return headers;
}

function preflightResponse(request) {
  const headers = corsHeadersFor(request);
  if (!headers) {
    return new Response(JSON.stringify({ error: "Blocked cross-site request" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

  headers.set(
    "Access-Control-Allow-Methods",
    request.headers.get("Access-Control-Request-Method") || "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
  if (requestedHeaders) headers.set("Access-Control-Allow-Headers", requestedHeaders);
  headers.set("Access-Control-Max-Age", "600");
  appendVary(headers, "Access-Control-Request-Method");
  appendVary(headers, "Access-Control-Request-Headers");

  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS" && request.headers.has("Access-Control-Request-Method")) {
      return preflightResponse(request);
    }

    const url = new URL(request.url);
    url.hostname = UPSTREAM_HOST;
    url.port = "";

    const upstreamResponse = await fetch(new Request(url.toString(), request));
    const corsHeaders = corsHeadersFor(request);
    if (!corsHeaders) return upstreamResponse;

    const response = new Response(upstreamResponse.body, upstreamResponse);
    corsHeaders.forEach((value, key) => response.headers.set(key, value));
    appendVary(response.headers, "Origin");
    return response;
  }
};
