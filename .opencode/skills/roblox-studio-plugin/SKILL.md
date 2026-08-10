---
name: roblox-studio-plugin
description: Use when working on plugins/roblox-studio/ - the Luau Studio connector. Covers the pairing code flow, token rotation, file sync protocol, apply-patch handshake, and undo history. Do NOT use for backend business logic - the plugin is a thin connector, all rules live in the API.
---

# Roblox Studio Plugin Connector

## Scope

`plugins/roblox-studio/VectisCodeConnector.lua` is a thin HTTP client to the API. It does NOT contain AI, billing, auth, or business logic. All decisions live in `apps/api/src/`.

## Endpoints the plugin calls

- `POST /studio/pairing-code` - request a pairing code
- `POST /studio/claim` - exchange code for session token
- `POST /studio/rotate-token` - rotate the connector token
- `POST /studio/sync` - report file count + source hash
- `GET /projects/{id}/pending-patch` - fetch approved change set
- `POST /projects/{id}/patch-result` - report apply success/failure
- `POST /projects/{id}/undo` - roll back the last applied patch

## Flow

1. User clicks "Refresh Connection" -> pairing code request
2. User pastes code into web dashboard -> claim -> session token
3. Plugin resumes session, rotates token if expired, syncs project context
4. After web-side approval, plugin fetches pending patch
5. User clicks "Apply Pending Patch" -> plugin reports result + keeps short undo history

## Rules

- Always send `Authorization: Bearer <token>` after pairing
- Rotate token on 401 response, retry once
- Keep undo history in plugin memory only (not persisted) - max 10 entries
- Never trust plugin-reported file paths - the API re-validates every patch
- The plugin should fail closed on any non-200 from the API
- Default API endpoint is `https://api.vectiscode.com`. Localhost is dev-only and only when the user sets it explicitly

## Critical files

- `plugins/roblox-studio/VectisCodeConnector.lua:1` - entry point
- `apps/api/src/routes/studio.ts` - matching API routes
- `apps/web/src/components/StudioBridge.tsx` - web-side pairing UI
