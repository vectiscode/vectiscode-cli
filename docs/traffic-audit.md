# Cloudflare Traffic Audit

Use this when Cloudflare request totals look much higher than backend users or Web Analytics visits.

## What The Counters Mean

- Account and Zone Analytics count Cloudflare edge HTTP requests. This includes browser pages, assets, API calls, crawlers, probes, errors, and threats.
- Web Analytics counts browser visits and page views that run the Cloudflare beacon. Treat this as the closest current human browser signal.
- Backend users only count signed-in app users. Anonymous edge traffic can be high while backend users stay low.
- A single page view creates several requests because the browser also downloads HTML, CSS, JavaScript, images, analytics beacons, and runtime API data.

## Run The Audit

Public checks work without credentials:

```powershell
npm run audit:traffic
```

The command prints JSON with:

- Live headers for key public routes, assets, plugin download, and API health/config endpoints.
- Cloudflare cache status for the hero logo and static assets.
- Whether Cloudflare Web Analytics and Rocket Loader are active on the served HTML.
- Parsed `robots.txt` and `sitemap.xml` signals.
- Plain-language findings for the current traffic posture.

For deeper Cloudflare Analytics, set a read-only token and zone id before running:

```powershell
$env:CLOUDFLARE_API_TOKEN = "<read-only-token>"
$env:CLOUDFLARE_ZONE_ID = "<zone-id>"
$env:TRAFFIC_AUDIT_HOURS = "48"
npm run audit:traffic
```

The credentialed mode queries Cloudflare GraphQL for top paths and 4xx/5xx groups using `requestSource: "eyeball"`. Keep the token read-only and never commit it.

## Investigation Order

1. Check `cloudflare.errors4xx` and `cloudflare.errors5xx`.
2. Look for repeated unknown paths, old asset names, API probes, or scanner user agents.
3. Compare `/`, `/download`, `/sitemap.xml`, `/robots.txt`, `/api/*`, `/cdn-cgi/*`, `/assets/*`, and `/images/*`.
4. If unknown paths dominate, handle them with Cloudflare WAF or rules instead of app code.
5. If known assets dominate bandwidth, inspect cache status and file size.
6. If Web Analytics stays low while edge requests stay high, treat the difference as crawler, probe, preflight, and asset traffic unless logs show otherwise.

## Current Baseline From The May 16 Audit

- Web Analytics showed `52` visits and `68` page views.
- Account Analytics showed about `50.23k` edge requests and `481.23 MB` bandwidth.
- AI Crawl Control identified `123` AI crawler requests, so AI crawlers explain only a small part of the total.
- The worst LCP sample pointed at `/images/logo-512.webp`, but the live asset is small and cached by Cloudflare.
- Rocket Loader and Cloudflare Web Analytics are active on the live page.

## Safe Defaults

- Leave crawler blocking unchanged while traffic is only noisy and not harmful.
- Use Web Analytics for human browser trend checks.
- Use Account or Zone Analytics for everything Cloudflare served.
- Use Log Search or the credentialed GraphQL output before changing WAF, AI Crawl Control, cache rules, or robots policy.
