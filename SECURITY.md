# Security policy

## Reporting a vulnerability

Do not open a public issue for credential exposure, path escape, permission bypass, arbitrary command execution, Studio mutation without approval, or account data exposure.

Report security issues privately through GitHub Security Advisories for `vectiscode/vectiscode-cli`. Include affected versions, reproduction steps, impact, and any suggested mitigation. Please avoid accessing data or projects you do not own.

We will acknowledge a complete report as soon as practical, investigate it, and coordinate a fix and disclosure. Security fixes may be released without advance public detail.

## Supported versions

During the public alpha, only the newest `alpha` release is supported. Upgrade before reporting an issue that is already fixed in a newer prerelease.

## Security model

VectisCode stores saved provider credentials in the operating system keychain and fails closed if secure storage is unavailable. Environment variables are ephemeral overrides. Workspace path checks, explicit permissions, local mutation receipts, and checkpoints are security boundaries and must not be bypassed for convenience.
