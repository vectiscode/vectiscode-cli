# Contributing to VectisCode

Thanks for helping make Roblox development tooling more dependable.

## Development setup

1. Install Node.js 20 or newer.
2. Run `npm ci` from the repository root.
3. Create a focused branch and keep unrelated changes out of the patch.
4. Run `npm run typecheck`, `npm test`, and `npm run build` before opening a pull request.

CLI changes should also pass `npm run pack:cli` and an install from the generated tarball in an empty directory. Website changes should pass `npm run test:visual` on desktop and mobile.

## Design boundaries

- Provider-specific request and response shapes belong in `packages/providers`, not core orchestration.
- Roblox Studio communication must use the official MCP client boundary in `packages/roblox`.
- Never add plaintext credential storage or log secret values.
- Resolve filesystem tools against the project root and preserve traversal and symlink checks.
- Keep destructive, external, and unknown tools behind explicit approval.
- Public claims must describe behavior that is implemented and verified.

## Pull requests

Explain the user-visible outcome, the risk boundary, and the checks you ran. Add deterministic tests for agent-loop, provider, storage, permission, or MCP behavior. Do not include provider keys, local sessions, project source, `.env` files, or generated package tarballs.

By contributing, you agree that your contribution is licensed under the MIT License.
