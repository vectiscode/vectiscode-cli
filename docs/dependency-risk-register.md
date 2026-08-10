# Dependency Risk Register

## Accepted temporary risk

### discord.js transitive undici advisory

- Path: `discord.js@14.26.4 -> undici@6.24.1`
- Severity: high advisory inherited through `undici`
- Status: temporarily accepted
- Review deadline: 2026-07-15
- Reason: the current Discord 14 release pins `undici` exactly and npm reports no compatible patched 14.x release. The automatic remediation proposes Discord 13, which is a breaking downgrade.
- Exposure: Discord bot HTTP and WebSocket traffic only. The web app, API HTTP server, Studio connector, and billing client do not use this transitive client.
- Mitigation: keep Discord input validation and rate limits enabled, do not route general user-controlled proxy traffic through the bot, and upgrade immediately when a compatible Discord release ships.
- Verification: `npm run audit:dependencies` fails for any other high or critical advisory and fails after the review deadline.

The remaining current `esbuild` advisory is low severity and limited to local Windows development-server behavior. Vite itself has been upgraded to the patched 7.3.5 release.
