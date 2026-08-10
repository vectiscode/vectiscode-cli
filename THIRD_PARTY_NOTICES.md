# Third-Party Notices

This file satisfies MIT attribution for upstream code imported into this repository.

## OpenCode

- Project: OpenCode (https://github.com/anomalyco/opencode)
- Release: v1.18.16
- Commit: `a3647eb025c7615159d417dcc49fc39fdaeba65b`
- License: MIT
- Copyright: Copyright (c) OpenCode contributors
- Repository: https://github.com/anomalyco/opencode
- Release page: https://github.com/anomalyco/opencode/releases/tag/v1.18.16

### MIT License (OpenCode)

```
MIT License

Copyright (c) OpenCode contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Usage in this repository

Core CLI architecture subsystems derived from OpenCode are listed in `UPSTREAM.md` under Imported subsystems. All derived files retain upstream MIT headers where they existed. Local VectisCode modifications are noted in `UPSTREAM.md` under Local Changes on Top of Upstream.

## VectisCode

- Project: VectisCode CLI (https://github.com/vectiscode/vectiscode-cli)
- License: MIT
- Copyright: Copyright (c) 2026 VectisCode contributors
- License file: `LICENSE` at repository root

VectisCode as used in this repository is independent and is not affiliated with or endorsed by Roblox Corporation.

## Other Dependencies

Runtime and build dependencies retain their own licenses. Refer to the relevant `package.json` and the generated license attribution produced by the verification gate (`bun run verify` which includes a license attribution check) for the complete list.

## Maintenance

Update this file whenever upstream-derived code is added or changed. Keep the OpenCode version, commit, and subsystem list synchronized with `UPSTREAM.md`.
