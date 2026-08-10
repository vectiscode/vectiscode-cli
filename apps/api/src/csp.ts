/**
 * CSP - Single source of truth for Content-Security-Policy headers.
 *
 * The API has a strict CSP (it only serves JSON).
 * The web has a broader CSP that allows Firebase SDKs and Cloudflare
 * Insights. Keep both lists in sync; the post-deploy health check
 * enforces no 'unsafe-inline' or 'unsafe-eval'.
 *
 * WHEN UPDATING THE WEB CSP: also update apps/web/public/_headers
 * to match. Run `npm run deploy:health` to verify.
 */

export const API_DIRECTIVES: readonly [string, string][] = [
  ["default-src", "'none'"],
  ["base-uri", "'none'"],
  ["form-action", "'none'"],
  ["frame-ancestors", "'none'"]
];

export const WEB_CSP =
  "default-src 'self'; worker-src 'self' blob:; script-src 'self' 'sha256-ZswfTY7H35rbv8WC7NXBoiC7WNu86vSzCDChNWwZZDM=' https://apis.google.com https://www.gstatic.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://api.vectiscode.com wss://api.vectiscode.com https://auth.vectiscode.com https://*.firebaseapp.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://firebaselogging.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://cloudflareinsights.com https://*.cloudflareinsights.com; frame-src 'self' https://accounts.google.com https://apis.google.com https://*.firebaseapp.com https://auth.vectiscode.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests";


export function renderApiCsp(): string {
  return API_DIRECTIVES.map(([k, v]) => `${k} ${v}`).join("; ");
}

const SECURITY_HEADERS: [string, string][] = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "no-referrer"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"]
];

export function getApiSecurityHeaders(isProduction: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of SECURITY_HEADERS) {
    out[k] = v;
  }
  out["Content-Security-Policy"] = renderApiCsp();
  if (isProduction) {
    out["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
  }
  return out;
}
