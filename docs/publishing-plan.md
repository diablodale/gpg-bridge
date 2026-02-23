# Publishing Plan: gpg-bridge

## Overview

This plan covers the complete path from the current broken/unpublished state to a
polished, published extension set on the VS Code marketplace and GitHub Releases.

Six phases in dependency order:

1. **Rename** — project rename from `gpg-windows-relay` to `gpg-bridge`
2. **Bundle** — fix broken VSIX packaging with esbuild
3. **Identity** — publisher account and manifest IDs
4. **Quality** — icons, READMEs, CHANGELOG, CONTRIBUTING
5. **Publish** — first marketplace release + GitHub Release
6. **CI/CD** — GitHub Actions for automated build and publish

Every phase ends with a full test gate before committing to git.

---

## Name Mapping

| Old token | New token | Where used |
|-----------|-----------|------------|
| `gpg-windows-relay` | `gpg-bridge` | repo name, pack extension `name`, URLs |
| `gpg-windows-relay-monorepo` | `gpg-bridge-monorepo` | root `package.json` `name` |
| `agent-proxy/` | `gpg-bridge-agent/` | directory, extension `name` |
| `request-proxy/` | `gpg-bridge-request/` | directory, extension `name` |
| `GPG Agent Proxy` | `GPG Bridge Agent` | `displayName`, output channel, status bar |
| `GPG Request Proxy` | `GPG Bridge Request` | `displayName`, output channel |
| `GPG Windows Relay` | `GPG Bridge` | pack `displayName` |
| `gpg-agent-proxy.*` | `gpg-bridge-agent.*` | VS Code command IDs |
| `gpg-request-proxy.*` | `gpg-bridge-request.*` | VS Code command IDs |
| `_gpg-agent-proxy.*` | `_gpg-bridge-agent.*` | internal cross-extension command IDs |
| `_gpg-request-proxy.*` | `_gpg-bridge-request.*` | internal test command IDs |
| `gpgAgentProxy.*` | `gpgBridgeAgent.*` | VS Code config keys |
| `gpgRequestProxy.*` | `gpgBridgeRequest.*` | VS Code config keys |
| `@gpg-relay/shared` | `@gpg-bridge/shared` | npm package name, all import paths |
| `local` (publisher) | `hidale` | all extension `package.json` publisher fields |
| `local.gpg-agent-proxy` | `hidale.gpg-bridge-agent` | `extensionDependencies`, `extensionPack` |
| `local.gpg-request-proxy` | `hidale.gpg-bridge-request` | `extensionPack` |
| `github.com/diablodale/gpg-windows-relay` | `github.com/diablodale/gpg-bridge` | `repository.url`, `bugs.url` |

`shared/` directory name stays — already generic.

---

## Phase 1 — Project Rename ✅ COMPLETE

### Goal
Rename every name token before any other work so that subsequent phases use the
correct names from the start and no rename needs to be repeated.

### Prerequisites
- GitHub repo must be renamed by the user **before** this phase's commit:
  GitHub → repository Settings → Rename → `gpg-bridge`.
  GitHub auto-redirects the old URL for existing clones.
- After the GitHub rename, update your local git remote to the new URL:
  ```powershell
  git remote set-url origin https://github.com/diablodale/gpg-bridge
  ```
  Verify with `git remote -v` before pushing the Phase 1 commit.

### Steps

**1a. Directory renames via `git mv`** (preserves git history):
- `git mv agent-proxy gpg-bridge-agent`
- `git mv request-proxy gpg-bridge-request`
- `pack/` stays — its directory name is already neutral

**1b. Root [package.json](../package.json)** — update:
- `name`: `gpg-windows-relay-monorepo` → `gpg-bridge-monorepo`
- `description`: update display text
- `clean` script globs: `agent-proxy/gpg-agent-proxy-*.vsix` → `gpg-bridge-agent/gpg-bridge-agent-*.vsix`, etc.
- All `cd agent-proxy` / `cd request-proxy` script paths → `cd gpg-bridge-agent` / `cd gpg-bridge-request`

**1c. Extension package.json files** — apply full name mapping table above to:
- [gpg-bridge-agent/package.json](../gpg-bridge-agent/package.json): `name`, `displayName`,
  all command IDs, config key prefix, `repository.url`, `bugs.url`,
  dependency `@gpg-relay/shared` → `@gpg-bridge/shared`
- [gpg-bridge-request/package.json](../gpg-bridge-request/package.json): same, plus
  `extensionDependencies` entry → `hidale.gpg-bridge-agent`
- [shared/package.json](../shared/package.json): `name` → `@gpg-bridge/shared`
- [pack/package.json](../pack/package.json): `name`, `displayName`, both `extensionPack`
  entries, `repository.url`, `bugs.url`

**1d. TypeScript source and test files** — mechanical token replacements:

*Import paths* (all `.ts` files across both extensions, shared, and integration tests):
- `from '@gpg-relay/shared'` → `from '@gpg-bridge/shared'`
- `from '@gpg-relay/shared/test'` → `from '@gpg-bridge/shared/test'`
- `from '@gpg-relay/shared/test/integration'` → `from '@gpg-bridge/shared/test/integration'`

*Command ID strings* in [commandExecutor.ts](../gpg-bridge-request/src/services/commandExecutor.ts),
both `extension.ts` files, and all integration test files:
- `'_gpg-agent-proxy.connectAgent'` → `'_gpg-bridge-agent.connectAgent'`
- `'_gpg-agent-proxy.sendCommands'` → `'_gpg-bridge-agent.sendCommands'`
- `'_gpg-agent-proxy.disconnectAgent'` → `'_gpg-bridge-agent.disconnectAgent'`
- `'gpg-agent-proxy.start'` → `'gpg-bridge-agent.start'`
- `'gpg-agent-proxy.stop'` → `'gpg-bridge-agent.stop'`
- `'gpg-agent-proxy.showStatus'` → `'gpg-bridge-agent.showStatus'`
- `'gpg-request-proxy.start'` → `'gpg-bridge-request.start'`
- `'gpg-request-proxy.stop'` → `'gpg-bridge-request.stop'`
- `'_gpg-request-proxy.test.getSocketPath'` → `'_gpg-bridge-request.test.getSocketPath'`

*Runner path strings* in [requestProxyRunTest.ts](../gpg-bridge-request/test/integration/requestProxyRunTest.ts)
and [gpgCliRunTest.ts](../gpg-bridge-request/test/integration/gpgCliRunTest.ts) — hardcoded
directory names in `extensionDevelopmentPath` and `extensionTestsPath` are not covered by the
import-path replacements above and must be updated separately:
- `path.join(workspaceRoot, 'agent-proxy')` → `path.join(workspaceRoot, 'gpg-bridge-agent')`
- `.../request-proxy/out/test/...` URI segments → `.../gpg-bridge-request/out/test/...`

*Configuration keys* in both `extension.ts` files and integration tests:
- `getConfiguration('gpgAgentProxy')` → `getConfiguration('gpgBridgeAgent')`
- `getConfiguration('gpgRequestProxy')` → `getConfiguration('gpgBridgeRequest')`

*UI strings* in [gpg-bridge-agent/src/extension.ts](../gpg-bridge-agent/src/extension.ts):
- `createOutputChannel('GPG Agent Proxy')` → `createOutputChannel('GPG Bridge Agent')`
- `statusBarItem.name = 'GPG Agent Proxy'` → `'GPG Bridge Agent'`
- All `'GPG Agent Proxy ...'` status bar label strings

*UI strings* in [gpg-bridge-request/src/extension.ts](../gpg-bridge-request/src/extension.ts):
- `createOutputChannel('GPG Request Proxy')` → `createOutputChannel('GPG Bridge Request')`

*Log strings* across all `.ts` files in both extensions — apply the name mapping
table to any string literal that refers to an extension by name, whether the
extension is referring to itself or cross-referencing the other. This covers
log messages, error strings, and any diagnostic text produced at runtime. The
output channel names (already covered above under UI strings) follow the same rule.

**1e. Documentation and dev container config** — apply name mapping to:
- [AGENTS.md](../AGENTS.md): command IDs, import paths, local workspace path reference
- [CHANGELOG.md](../CHANGELOG.md): `gpg-windows-relay` → `gpg-bridge` in prose
- [README.md](../README.md) (root): command IDs, config keys, display names, repo URL
- [gpg-bridge-agent/README.md](../gpg-bridge-agent/README.md): command IDs, cross-references
- [gpg-bridge-request/README.md](../gpg-bridge-request/README.md): command IDs, cross-references
- [.devcontainer/phase2/devcontainer.json](../.devcontainer/phase2/devcontainer.json): `mounts` target
  paths (`request-proxy/node_modules` → `gpg-bridge-request/node_modules`, `agent-proxy/node_modules`
  → `gpg-bridge-agent/node_modules`), `updateContentCommand` directory args, Docker volume source
  names (`gpg-relay-*` → `gpg-bridge-*`), container `name`, and comments
- [.devcontainer/phase3/devcontainer.json](../.devcontainer/phase3/devcontainer.json): same as phase2
  plus phase3-specific volume names (`gpg-relay-p3-*` → `gpg-bridge-p3-*`)
- [docs/](../docs/) plan files: **do not edit** — these are historical records of
  decisions made under the old name; retroactively changing them misrepresents
  the project history. They remain valid as-written.

**1f. tsconfig.json files** — no changes needed (no project-name path aliases).

### Verification gate
```powershell
# Re-link shared package under new name
npm install

# Clean build
npm run compile

# Unit tests
npm test

# If Docker containers from the old name still exist, remove them and their volumes
# before running integration tests — the renamed devcontainer.json uses new volume
# source names (gpg-bridge-*) so old containers will shadow the wrong directories.
# docker ps -a --filter "label=devcontainer.local_folder" to identify them.
# docker rm <id> ; docker volume rm gpg-relay-* gpg-relay-p3-*

# Integration tests (both extensions)
cd gpg-bridge-agent  && npm run test:integration
cd ../gpg-bridge-request && npm run test:integration
```
All must pass.

---

## Phase 2 — Fix VSIX Bundling ✅ COMPLETE

### Goal
Fix the broken `npm run package` command. Previously failed with:
```
ERROR invalid relative path: extension/../shared/node_modules/@types/chai/README.md
```

### Root Cause
`@gpg-bridge/shared: "file:../shared"` is listed in production `dependencies`.
vsce follows the symlink outside the extension root and attempts to archive
`../shared/node_modules/**` (3246 files). The path traversal is rejected.

### Fix: esbuild bundling
esbuild statically inlines all `import` statements at build time into a single
`out/extension.js`. At runtime, VS Code loads only that file — there are no
`node_modules` lookups at runtime. This makes `@gpg-bridge/shared` and `uuid`
build-time tools, so they belong in `devDependencies` where vsce ignores them.
Only `vscode` remains external (VS Code injects it into the extension host).

### Steps

Repeat for both `gpg-bridge-agent/` and `gpg-bridge-request/`:

**2a.** Install esbuild as a dev dependency:
```powershell
cd gpg-bridge-agent
npm install --save-dev esbuild
```

**2b.** Create `gpg-bridge-agent/esbuild.js`:
- Entry point: `./src/extension.ts`
- Output: `./out/extension.js`
- Format: `cjs` (CommonJS, required by VS Code extension host)
- Platform: `node`
- External: `['vscode']` only
- `--production` flag enables `minify: true` and `sourcemap: false`
- Without `--production`: `sourcemap: true`, no minification (for development)

**2c.** Update `gpg-bridge-agent/package.json` scripts:
- Add `"check-types": "tsc --noEmit"`
- Change `"vscode:prepublish"` → `"npm run check-types && node esbuild.js --production"`
- Change `"compile"` → keep as `"tsc -p ./"` (used during development + watch)
- Rename `"package"` → `"vsix"` (avoids collision with npm's built-in `package` lifecycle):
  `"vsix": "vsce package"`

**2d.** Move from `dependencies` → `devDependencies` in `gpg-bridge-agent/package.json`:
- `@gpg-bridge/shared`
- `uuid`

Rationale: esbuild inlines both at build time. vsce only packages `dependencies`.
Moving them to `devDependencies` prevents vsce from traversing `file:../shared`.

**2e.** Add to `gpg-bridge-agent/.vscodeignore`:
```
node_modules/**
```

**2f.** Remove stale `gpg-bridge-agent.restart` from `contributes.commands` in
`gpg-bridge-agent/package.json`. The command handler was removed during the
state machine refactor; the manifest entry was never cleaned up.

**2g.** Add `"api": "none"` to `gpg-bridge-request/package.json` — this field is
present in agent but missing from request. Both should be consistent.

**2h.** Update root `package.json`:
- `package:agent` script: `cd gpg-bridge-agent && npm run vsix`
- `package:request` script: `cd gpg-bridge-request && npm run vsix`
- `package:pack` script: `cd pack && npm run vsix` (add `"vsix": "vsce package"` to
  `pack/package.json` as well)

### Verification gate

**Tests first:**
```powershell
npm run compile
npm test
cd gpg-bridge-agent  && npm run test:integration
cd ../gpg-bridge-request && npm run test:integration
```

**Package both extensions:**
```powershell
cd c:\njs\gpg-bridge   # (after rename)
npm run package:agent
npm run package:request
```
Both must exit 0 and produce `.vsix` files.

**Inspect the VSIX contents** using `Expand-Archive` to verify correctness:
```powershell
# Extract agent VSIX to a temp folder
$vsix = Get-ChildItem gpg-bridge-agent\*.vsix | Select-Object -First 1
Expand-Archive -Path $vsix.FullName -DestinationPath "$env:TEMP\vsix-inspect" -Force

# Must be present: out/extension.js and must be non-trivially sized (bundled code)
Get-Item "$env:TEMP\vsix-inspect\extension\out\extension.js" | Select-Object Name, Length

# Must be absent: node_modules directory (proves vsce did not include deps)
Test-Path "$env:TEMP\vsix-inspect\extension\node_modules"   # Expected: False

# Must be absent: any path containing 'shared' from outside the extension root
Get-ChildItem "$env:TEMP\vsix-inspect" -Recurse -Filter "*.js" |
    Where-Object { $_.FullName -like '*shared*' } |
    Select-Object FullName

# Clean up
Remove-Item "$env:TEMP\vsix-inspect" -Recurse -Force
```

Repeat inspection for `gpg-bridge-request`.

> **Implementation notes (deviations from plan):**
> - `.vscodeignore` required 3 iterations beyond the planned `node_modules/**` addition.
>   Final state also excludes: `esbuild.js`, `eslint.config.mjs`, `.vscode-test.cjs`,
>   `**/tsconfig*.json` (catches `tsconfig.test.json`), and changed `out/test/**` →
>   `out/**` + `!out/extension.js` to prevent stale tsc output from being included.
> - Test gate (unit 124 + integration 24) all passed before commit.

---

## Phase 3 — Publisher Identity ✅ COMPLETE

### Goal
Replace the placeholder `"local"` publisher with the real `hidale` identity
so cross-extension dependencies resolve correctly and marketplace publish works.

### Steps

**3a.** Create marketplace publisher (manual, one-time) ✅ COMPLETE:
- Publisher ID: `hidale`, Display Name: `Dale Phurrough`
- Created via browser: [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) →
  signed in with Microsoft account

**3b.** In all three extension `package.json` files, update:
- `"publisher": "local"` → `"publisher": "hidale"`

**3c.** `gpg-bridge-request/package.json` `extensionDependencies`:
- `"local.gpg-agent-proxy"` → `"hidale.gpg-bridge-agent"`

**3d.** `pack/package.json` `extensionPack`:
- `"local.gpg-agent-proxy"` → `"hidale.gpg-bridge-agent"`
- `"local.gpg-request-proxy"` → `"hidale.gpg-bridge-request"`

**3e.** Align `@types/node` across all workspaces. Currently diverged:
- `gpg-bridge-agent`: `^22.19.9`
- `gpg-bridge-request`: `22.x`
- root: `^25.2.1`

Standardize to `^22.x` everywhere. VS Code's bundled Node.js runtime is v22;
matching this version avoids type mismatches and ensures API compatibility.

### Verification gate
```powershell
npm install   # picks up @types/node version changes
npm run compile
npm test
cd gpg-bridge-agent  && npm run test:integration
cd ../gpg-bridge-request && npm run test:integration
```

Spot-check: re-run `npm run package:agent`, unzip the VSIX, confirm
`extension/package.json` inside shows `"publisher": "hidale"`.

---

## Phase 4 — Quality Files ✅ COMPLETE

### Goal
Produce the assets required for a credible marketplace listing: icon, polished
READMEs, structured CHANGELOG, and a CONTRIBUTING guide.

### Steps

**4a. Icon** — create a single 128×128 PNG icon (GPG key / padlock motif).
One icon is shared across all three extensions. Place it as:
- `gpg-bridge-agent/icon.png`
- `gpg-bridge-request/icon.png`
- `pack/icon.png`

Reference from each `package.json`:
```json
"icon": "icon.png"
```

vsce requires the icon to be inside the extension folder; it cannot be a shared
symlink. Either copy the file or add a root-level build step to copy it.
Add `icon.png` to each extension's `.vscodeignore` exclusion allowlist by
ensuring it is **not** excluded (the default `.vscodeignore` does not exclude PNGs).

**4b. READMEs** — polish all three:
- Feature list and use-case description
- Installation instructions (marketplace + manual VSIX)
- Configuration reference (settings keys, defaults, descriptions)
- Command palette reference
- Architecture note (two-extension model, why it exists)
- Badge row: build status, VS Code marketplace version, license
  (badge URLs confirmed once marketplace IDs are live after Phase 5)

**4c. CHANGELOG.md** — restructure to [Keep a Changelog](https://keepachangelog.com) format:
```markdown
## [Unreleased]
## [0.1.0] - YYYY-MM-DD
### Added
- Initial public release
```

**4d. CONTRIBUTING.md** (new file at repository root):
- Prerequisites (Node.js, VS Code, Gpg4win on Windows)
- Dev setup: `git clone`, `npm install`, `npm run watch`
- Build: `npm run compile`
- Test: `npm test` (unit) + per-extension integration test commands
- VSIX packaging: `npm run package:agent`, `npm run package:request`
- Commit conventions (Conventional Commits v1, GPG signing requirement)
- PR guidelines

### Verification gate
```powershell
npm run compile
npm test
npm run test:integration
```

Build all three VSIXs (runs `prepackage` → icon render + deploy first):
```powershell
cd C:\njs\gpg-windows-relay
npm run package
```

Inspect the packaged README from each VSIX to confirm vsce rewrote all relative
URLs to correct absolute HTTPS GitHub raw URLs. The README inside the VSIX is the
transformed version — this is what the marketplace renders:
```powershell
$pIcon = "icon"; $pSrc = 'src="(?!https://(raw\.githubusercontent\.com|github\.com)/diablodale/gpg-bridge/)'; $pHref = 'href="(?!https://(github\.com|img\.shields\.io))'; $pRel = '\]\((?!http)'
@("gpg-bridge-agent\gpg-bridge-agent-0.0.1.vsix","gpg-bridge-request\gpg-bridge-request-0.0.1.vsix","pack\gpg-bridge-0.0.1.vsix") | ForEach-Object { Write-Host "`n=== $_ ===" -ForegroundColor Cyan; Copy-Item $_ _tmp.zip -Force; Expand-Archive _tmp.zip _vsix -Force; Remove-Item _tmp.zip; Write-Host "icon (expect github.com/diablodale/gpg-bridge/raw/HEAD/assets/icon.png):"; Select-String _vsix\extension\readme.md -Pattern $pIcon; Write-Host "bad src= (expect none):"; Select-String _vsix\extension\readme.md -Pattern $pSrc; Write-Host "bad href= (expect none):"; Select-String _vsix\extension\readme.md -Pattern $pHref; Write-Host "relative markdown links (expect none):"; Select-String _vsix\extension\readme.md -Pattern $pRel; Remove-Item _vsix -Recurse -Force }
```

Expected for icon: `src="https://github.com/diablodale/gpg-bridge/raw/HEAD/assets/icon.png"`.
vsce uses the `github.com/.../raw/HEAD/...` form (not `raw.githubusercontent.com`); both
hosts serve identical content. Any `src=` to the wrong repo, any remaining relative
`href=` or `](`, or a wrong repo path is a packaging defect.

Confirm required files are present in each VSIX and the vsixmanifest metadata is correct:
```powershell
@("gpg-bridge-agent\gpg-bridge-agent-0.0.1.vsix","gpg-bridge-request\gpg-bridge-request-0.0.1.vsix","pack\gpg-bridge-0.0.1.vsix") | ForEach-Object { Write-Host "`n=== $_ ===" -ForegroundColor Cyan; Copy-Item $_ _tmp.zip -Force; Expand-Archive _tmp.zip _vsix -Force; Remove-Item _tmp.zip; Write-Host "FILES:"; Get-ChildItem _vsix\extension -Name | Select-String "icon|readme|changelog|package"; Write-Host "MANIFEST:"; Get-Content _vsix\extension.vsixmanifest; Remove-Item _vsix -Recurse -Force }
```

Verify `capabilities` (`virtualWorkspaces`, `untrustedWorkspaces`) survived packaging —
vsce does not warn on unknown or silently dropped `package.json` fields
(pack has no capabilities block — agent and request only):
```powershell
@("gpg-bridge-agent\gpg-bridge-agent-0.0.1.vsix","gpg-bridge-request\gpg-bridge-request-0.0.1.vsix") | ForEach-Object { Write-Host "`n=== $_ ===" -ForegroundColor Cyan; Copy-Item $_ _tmp.zip -Force; Expand-Archive _tmp.zip _vsix -Force; Remove-Item _tmp.zip; Get-Content _vsix\extension\package.json | Select-String "virtualWorkspaces|untrustedWorkspaces"; Remove-Item _vsix -Recurse -Force }
```

> **Implementation notes (deviations from plan):**
> - Icon is 256×256 PNG (not 128×128 as originally planned) — larger source asset
>   is more future-proof for HiDPI displays; vsce accepts any size.
> - Icon source is `assets/icon.svg` (key-bridge-lock motif, Royal Blue `#3971ED` +
>   Amber `#EDB539`). Rendered via `@resvg/resvg-js` (Rust-based, no Inkscape dependency).
> - `icon.png` copies in extension folders are **gitignored** — `assets/icon.png` is
>   the committed canonical PNG. Copies are deployed automatically via:
>   - `npm run icon` (render + deploy, alias: `icon:render` + `icon:deploy`)
>   - `postinstall` hook (deploys on `npm install`, so fresh clones work immediately)
>   - `prepackage` hook (re-renders + deploys before every `npm run package`)
> - Extension READMEs trimmed to marketplace-only content (Requirements, Configuration,
>   Commands, How It Works, Contributing footer). Full developer reference migrated to
>   `docs/agent-internals.md` and `docs/request-internals.md`.
> - Badge URLs in all READMEs are commented placeholders — to be activated in Phase 5
>   once the marketplace extensions are live.
> - CHANGELOG hardcodes `[0.1.0] - TBD`; date to be filled in during Phase 5.
> - Test gate: 124 unit tests passing; all three VSIXs package cleanly with `icon.png`.

---

## Phase 4.1 — Pre-commit Hooks ✅ COMPLETE

### Goal
Enforce code quality and commit hygiene locally before pushes reach GitHub.
Catches failures fast (lint errors, type errors, unsigned commits, malformed
commit messages) without waiting for CI.

### Tools selected

| Tool | Role | Install |
|------|------|---------|
| **[prek](https://prek.j178.dev/)** v0.3.3 | Hook manager — Rust binary, fast, no Python runtime, pre-commit-compatible TOML config | `npm install` (via `@j178/prek` devDependency) |
| **[commitlint](https://commitlint.js.org/)** | Conventional Commits validator (`commit-msg` hook) — Node.js, no separate install | `npm install` (via `@commitlint/cli` + `@commitlint/config-conventional` devDependencies) |

Both tools are npm devDependencies — auto-installed for every dev on `npm install`.
No separate binary install required.

### Hooks implemented

| Hook | Trigger | What runs |
|------|---------|----------|
| `pre-commit` | `git commit` | `npm run compile` (priority 0), then `npm run lint` (priority 10) |
| `commit-msg` | after message entered | `node node_modules/.bin/commitlint --edit <file>` |
| `pre-push` | `git push` | `npm test` (unit suite) |

> **Signing** is enforced server-side by the GitHub repository ruleset (active on
> `main` as of Phase 4). A pre-commit hook cannot reliably check signing because
> the signature is applied by git itself during commit — any hook that runs
> *before* commit cannot inspect it. The ruleset rejection on push is the correct
> enforcement point.

### Files added / changed

| File | Change |
|------|--------|
| `prek.toml` | Hook configuration (new) |
| `commitlint.config.js` | commitlint configuration: `extends @commitlint/config-conventional` (new) |
| `scripts/setup-hooks.js` | Node script: runs `prek install` during `postinstall`, skips gracefully outside a git repo (new) |
| `package.json` | Added `@commitlint/cli`, `@commitlint/config-conventional`, `@j178/prek` devDependencies; added `lint` / `lint:shared` / `lint:agent` / `lint:request` scripts; appended `node scripts/setup-hooks.js` to `postinstall` |
| `CONTRIBUTING.md` | Added "Git Hooks" section: hook table, install instructions, bypass notes |

### Steps

**4.1a.** ✅ Tool selection: prek (hook manager) + commitlint (commit-msg validator).

**4.1b.** ✅ `prek.toml` at repo root; `@j178/prek` in root devDependencies; `postinstall`
calls `node scripts/setup-hooks.js` which runs `prek install` when `.git` exists.

**4.1c.** ✅ `pre-commit` hook: `compile` (priority 0) → `lint` (priority 10).

**4.1d.** ✅ `commit-msg` hook: `node node_modules/.bin/commitlint --edit <file>`
configured via `commitlint.config.js` (`extends @commitlint/config-conventional`).

**4.1e.** ✅ `pre-push` hook: `npm test` (unit suite only — integration tests require a live GPG agent and VS Code host, so they run in CI rather than a hook).

**4.1f.** ✅ Manual verification:
- `npm run compile` — passes clean ✅
- `npm run lint` — passes clean ✅
- Hook files installed: `.git/hooks/pre-commit`, `.git/hooks/commit-msg`, `.git/hooks/pre-push` ✅
- End-to-end blocking tests (bad TS, bad lint, bad message, failing tests) — verified at commit time

**4.1g.** ✅ CONTRIBUTING.md updated with "Git Hooks" section.

---

## Phase 4.2 — Local Version Management

### Goal
Configure `commit-and-tag-version` for local changelog generation, lockstep version
bumping across all five packages, and `v*` tag creation — all offline, against the
local git repo without any GitHub API involvement.

**Relationship to other phases:**
- **Phase 5** — first marketplace release uses `--release-as 1.0.0` to explicitly declare
  the public debut version regardless of what the last dev tag auto-increment would
  produce; this replaces the manual per-file edits in Phase 5 step 5a
- **Phase 6** — when `release-please` is activated, remove `commit-and-tag-version`
  entirely; `release-please` reads existing `v*` tags from git history and adopts them
  seamlessly — no migration required

### Why this tool
`commit-and-tag-version` reads the local git log, determines the semver bump from
Conventional Commit prefixes, then writes `CHANGELOG.md`, bumps `version` in all
configured `package.json` files, and creates a local git commit + `v*` tag.
Fully offline — no GitHub API, no PR, no bot account required.

### Steps

**4.2a.** ✅ Add `commit-and-tag-version` as a root devDependency and add release scripts:
```powershell
cd c:\njs\gpg-windows-relay
npm install --save-dev commit-and-tag-version
```
Add to root `package.json` `scripts`:
```json
"release": "commit-and-tag-version",
"release:dry-run": "commit-and-tag-version --dry-run"
```

**4.2b.** ✅ Add `commit-and-tag-version` configuration to the root `package.json` under
a `"commit-and-tag-version"` key. This keeps all release tooling config in one file
rather than a separate `.versionrc.json`.

> **Deviation:** `commitlint` config was also migrated from `commitlint.config.js` into
> `package.json` at the same time, adding a `type-enum` rule to enforce the same type list
> used by `commit-and-tag-version`. `commitlint.config.js` now contains only a redirect comment.

Add the following top-level key to root `package.json`:
```json
"commit-and-tag-version": {
  "bumpFiles": [
    { "filename": "package.json",                   "type": "json" },
    { "filename": "gpg-bridge-agent/package.json",  "type": "json" },
    { "filename": "gpg-bridge-request/package.json","type": "json" },
    { "filename": "pack/package.json",              "type": "json" },
    { "filename": "shared/package.json",            "type": "json" }
  ],
  "header": "# Changelog\n\nAll notable changes to this project will be documented in this file.\nSee [Conventional Commits](https://conventionalcommits.org) for guidelines.",
  "bumpStrict": true,
  "sign": true,
  "noVerify": true,
  "scripts": {
    "postchangelog": "node -e \"const fs=require('fs');['gpg-bridge-agent','gpg-bridge-request','pack'].forEach(d=>{fs.copyFileSync('CHANGELOG.md',d+'/CHANGELOG.md');console.log(d+'/CHANGELOG.md copied');})\"",
    "precommit": "git add gpg-bridge-agent/CHANGELOG.md gpg-bridge-request/CHANGELOG.md pack/CHANGELOG.md"
  },
  "types": [
    { "type": "feat",      "section": "Added"         },
    { "type": "feat",      "section": "Removed", "scope": "remove" },
    { "type": "feat",      "section": "Removed", "scope": "removed" },
    { "type": "fix",       "section": "Fixed"         },
    { "type": "perf",      "section": "Performance"   },
    { "type": "security",  "section": "Security"      },
    { "type": "deprecate", "section": "Deprecated"    },
    { "type": "docs",      "hidden": true },
    { "type": "chore",     "hidden": true },
    { "type": "refactor",  "hidden": true },
    { "type": "test",      "hidden": true },
    { "type": "build",     "hidden": true },
    { "type": "ci",        "hidden": true }
  ]
}
```

**Commit type versioning policy:**

- `BREAKING CHANGE`/`!` → major
- `feat:` → minor
- any visible (non-hidden) type → patch
- only hidden-type commits (`docs`, `chore`, `refactor`, `test`, `build`, `ci`) → **no release**

Bump level is determined by the `conventionalcommits` preset's `whatBump` function
([source](https://github.com/conventional-changelog/conventional-changelog/blob/master/packages/conventional-changelog-conventionalcommits/src/whatBump.js)):
`BREAKING CHANGE`/`!` upgrades to major; `feat` upgrades to minor; everything
else visible triggers patch. With `bumpStrict: true`, if every commit in the batch
is a hidden type, `whatBump` returns `null` — no bump, no tag, no release.
`security`, `deprecate`, `perf`, and other custom types are unrecognized by
`whatBump` but are **visible** (not hidden), so they fall through to patch.

`feat(remove)` uses the `scope` field to route removals into the `Removed` section
while still auto-bumping minor via the `feat` type.
`deprecate` goes in `Deprecated` section and produces a patch bump (it is visible).

**4.2c.** Bootstrap: replace the existing hand-written `CHANGELOG.md` with a clean
tool-managed file and create the initial `v0.1.0` tag. The `v0.0.0` anchor tag was
already manually applied to a previous commit — the tool will walk commits from that
point forward and include them in the `[0.1.0]` CHANGELOG section. The starting tag
is **exclusive**: the commit tagged `v0.0.0` itself does not appear; only commits
after it do.

> **Why not `--first-release`?** That flag tags at the current `package.json` version
> without bumping — but it also does **not** write to `bumpFiles`. In a monorepo the
> four sub-package `package.json` files would not be updated, leaving versions out of
> sync. `--release-as 0.1.0` writes to all five `bumpFiles` correctly.

```powershell
# Replace existing CHANGELOG.md with the header only (tool will prepend entries above this)
Set-Content CHANGELOG.md "# Changelog`n`nAll notable changes to this project will be documented in this file.`nSee [Conventional Commits](https://conventionalcommits.org) for commit guidelines."

# Generate CHANGELOG from v0.0.0..HEAD, bump all package.json files to 0.1.0, commit, tag
npm run release -- --release-as 0.1.0

# Verify the release commit and tag are both GPG signed
git log --show-signature -1
git verify-tag v0.1.0

git push --follow-tags
```
All five `package.json` files are now at `0.1.0`, the `[0.1.0]` CHANGELOG section
contains all conventional commits since `v0.0.0`, and the `v0.1.0` tag exists in
the repository. All subsequent runs generate incrementally from the latest tag.

**4.2d.** Verify dry-run output before the first normal release. No files are changed:
```powershell
npm run release:dry-run
```
Confirms that only commits since `v0.1.0` appear in the preview and the bump is correct.

### Usage (recurring — deliberate releases only, not on every push)

```powershell
npm run release                              # auto-detects patch/minor/major from commits
npm run release -- --release-as minor        # force a specific bump type
git push --follow-tags                       # push the commit + v* tag to GitHub
```

> Releases are a deliberate act. Normal development commits are pushed to `main`
> without running `npm run release`. Run it only when you decide a set of completed
> work is worth versioning — the pre-push hook runs `npm test` regardless.

**Phase 5 note**: by Phase 5 there will already be `v*` tags from development cycles.
Use `--release-as 1.0.0` to explicitly declare the marketplace launch version regardless
of what auto-increment would calculate from the last dev tag (e.g., `v0.0.7` + `fix:` commits
would auto-produce `v0.0.8`, not `v1.0.0`):
```powershell
npm run release -- --release-as 1.0.0
git push --follow-tags
```
This replaces the manual per-file version edits described in Phase 5 step 5a.

**Phase 6 transition**: when `release-please` is active, remove `commit-and-tag-version`
from devDependencies, remove the `"commit-and-tag-version"` config block and the
`release`/`release:dry-run` scripts from `package.json`. All `v*` tags already in git
history are immediately usable by `release-please` as its baseline — no other migration needed.

### Files added / changed

| File | Change |
|------|--------|
| `package.json` | `commit-and-tag-version` devDependency; `release` and `release:dry-run` scripts; `"commit-and-tag-version"` config block (`bumpFiles`, `header`, `bumpStrict`, `sign`, `noVerify`, `scripts`, `types`); `"commitlint"` config block (moved from `commitlint.config.js`, with `type-enum` rule added) |
| `commitlint.config.js` | config now lives in `package.json` |

### Verification gate

```powershell
npm run release:dry-run
```
Expected: CHANGELOG preview and version printed, no files written.

---

## Phase 5 — First Publish (bootstrap)

### Goal
Publish v1.0.0 to the VS Code marketplace and create a GitHub Release with all
three VSIX artifacts attached.

> **This is the only manual marketplace publish.** Phase 6 sets up `release-please`
> to automate future releases from GitHub — no manual VSIX packaging or publishing
> required after that. Version bumping and tagging are already automated locally
> via Phase 4.2.

### Steps

**5a.** Bump version to `1.0.0`, generate CHANGELOG entry, commit, and tag using
Phase 4.2 tooling (see Phase 4.2 for setup). The `--release-as` flag overrides
auto-increment to declare the explicit marketplace launch version:
```powershell
npm run release -- --release-as 1.0.0
git push --follow-tags
```
This bumps all five `package.json` files in lockstep, appends to `CHANGELOG.md`,
creates a `chore(release): 1.0.0` commit, and creates the `v1.0.0` tag locally.

**5b.** Confirm `"preview"` is absent from all extension `package.json` files.
(Decided: remove `"preview": true` — extension is functional and tested.)

**5c.** Produce final VSIXs:
```powershell
npm run package:agent
npm run package:request
cd pack && npx vsce package
```

**5d.** Authenticate vsce locally before publishing. The `VSCE_PAT` CI secret
does not exist yet (that is Phase 6), so use a personal access token directly.
Create a PAT now following the same Azure DevOps steps described in Phase 6 step
6e — you can reuse this same token when setting up the GitHub secret in Phase 6.
Then authenticate:
```powershell
$env:VSCE_PAT = "<your-azure-devops-pat>"
```
vsce reads this environment variable automatically during `vsce publish`.

**5e.** Publish to marketplace in dependency order (agent must exist before
request can declare `extensionDependencies`):
```powershell
cd gpg-bridge-agent      && npx vsce publish
cd ../gpg-bridge-request && npx vsce publish
cd ../pack               && npx vsce publish
```

**5f.** Update README badge URLs now that marketplace IDs are live.

**5g.** Create GitHub Release manually (Phase 6 automates this for future releases):
- On GitHub: Releases → Draft a new release
- Tag: `v1.0.0` (already exists — pushed in step 5a via `git push --follow-tags`;
  select it from the tag dropdown rather than creating a new one)
- Title: `v1.0.0 — Initial release`
- Body: paste the `[1.0.0]` section from CHANGELOG.md
- Attach all three `.vsix` files as release assets

### Verification gate
```powershell
npm run compile
npm test
cd gpg-bridge-agent      && npm run test:integration
cd ../gpg-bridge-request && npm run test:integration
```

> **No manual commit needed.** The `npm run release -- --release-as 1.0.0` command
> in step 5a already created the commit `chore(release): 1.0.0` and pushed it
> along with the `v1.0.0` tag.

---

## Phase 6 — CI/CD and Automated Releases

### Goal
Add three GitHub Actions workflows:
1. **CI** — validate every push and PR (build + test)
2. **Publish** — package and publish to marketplace when a `v*` tag is pushed
3. **release-please** — automatically open and maintain a "Release PR" after
   every merge to `main`, so future releases require only merging that PR

### Background: GitHub Actions and bots

GitHub Actions are automated workflows defined as YAML files in `.github/workflows/`.
Each file declares *when* it runs (triggers) and *what it does* (steps). Steps can
run shell commands, call pre-built actions from the GitHub Actions Marketplace, or
interact with the GitHub API.

`release-please` is a pre-built action (`googleapis/release-please-action`) that
acts as a bot. After every merge to `main` it:
1. Reads your git commit messages since the last release tag
2. Determines the next semver version from Conventional Commit prefixes
   (`fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major)
3. Opens (or updates) a single PR titled e.g. `chore: release 1.0.1`
4. That PR contains: bumped versions in all tracked `package.json` files +
   a new `CHANGELOG.md` section generated from the commit messages
5. When **you merge that PR**, release-please creates a `v1.0.1` tag
6. The `publish.yml` workflow detects the new tag and fires automatically

You never write version numbers or CHANGELOG entries by hand after Phase 6.

### Steps

**6a.** Create `release-please-config.json` at the repository root. This tells
release-please which `package.json` files to bump (lockstep — all share one version):
```json
{
  "$schema": "https://wdcp.dev/release-please-config.schema.json",
  "release-type": "node",
  "packages": {
    ".": {},
    "gpg-bridge-agent": {},
    "gpg-bridge-request": {},
    "pack": {},
    "shared": {}
  },
  "plugins": [
    {
      "type": "linked-versions",
      "groupName": "gpg-bridge",
      "components": ["gpg-bridge-monorepo", "gpg-bridge-agent", "gpg-bridge-request", "gpg-bridge", "@gpg-bridge/shared"]
    },
    "sentence-case"
  ]
}
```
The `linked-versions` plugin keeps all five packages at the same version — matching
the lockstep versioning policy established in Phase 5. Component names are the npm
`name` fields from each `package.json`: `gpg-bridge-monorepo` (root), `gpg-bridge-agent`,
`gpg-bridge-request`, `gpg-bridge` (pack), and `@gpg-bridge/shared`.
The `sentence-case` plugin capitalizes the leading word of each changelog entry.

**6b.** Create `.release-please-manifest.json` at the repository root. This is
release-please's state file — it records the current version of each package so
it knows what to bump from. Set it to whatever `v*` tag was last produced by
Phase 4.2 (expected to be `1.0.0` after the Phase 5 release):

> **Phase 4.2 cleanup**: before committing this file, remove `commit-and-tag-version`
> from root `package.json` devDependencies, delete `.versionrc.json`, and remove the
> `release` and `release:dry-run` scripts — Phase 6 takes over from here.

After Phase 5 publish it should be:
```json
{
  ".": "1.0.0",
  "gpg-bridge-agent": "1.0.0",
  "gpg-bridge-request": "1.0.0",
  "pack": "1.0.0",
  "shared": "1.0.0"
}
```

**6c.** Create `.github/workflows/release-please.yml`:
```yaml
name: release-please
on:
  push:
    branches: [main]
jobs:
  release-please:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```
`permissions: contents: write` allows the bot to create tags and update files.
`permissions: pull-requests: write` allows the bot to open and update the release PR.

**6d.** Create `.github/workflows/ci.yml` — triggers on every push and PR to `main`:
- Runner: `ubuntu-latest`
- Steps: checkout → Node.js 22 setup → `npm install` → `npm run compile` →
  `npm test` → integration tests for both extensions
- Annotates test failures inline in the PR diff

**6e.** Create a Marketplace publish token and store it as a GitHub Actions secret
(manual, one-time). The VS Code Marketplace runs on Azure DevOps infrastructure,
so the token is created at Azure DevOps — not on GitHub or the marketplace page.

*Step 1 — Create the Azure DevOps PAT:*
1. Sign into [dev.azure.com](https://dev.azure.com) with the Microsoft account
   linked to the `hidale` marketplace publisher
2. Top-right avatar → **Personal access tokens** → **New Token**
3. Name: `vsce-publish` (or any descriptive label)
4. Organization: `All accessible organizations`
5. Scopes: select **Custom defined** → tick **Marketplace → Publish** only
6. Click Create — **copy the token value immediately**, Azure shows it only once

*Step 2 — Store it as a GitHub repository secret:*
1. GitHub → repository Settings → Secrets and variables → Actions →
   **New repository secret**
2. Name: `VSCE_PAT`
3. Value: paste the Azure DevOps token from Step 1

The secret name `VSCE_PAT` is a convention from the vsce docs. It must match
what the `publish.yml` workflow references. The token never appears in code.

**6f.** Create `.github/workflows/publish.yml` — triggers when release-please
pushes a `v*` tag (which happens when the release PR is merged):
- Runner: `ubuntu-latest`
- Steps:
  1. Checkout
  2. Node.js 22 setup
  3. `npm install`
  4. `npm run compile` + `npm test` — abort if tests fail
  5. `npm run package:agent` + `npm run package:request` + `cd pack && npx vsce package`
  6. Publish all three via `npx vsce publish` using the `VSCE_PAT` secret (created in 6e)
  7. Create GitHub Release via `gh` CLI, attach all three `.vsix` files,
     and use the CHANGELOG section for the release body

> **Note: GPG signing and bot commits**
> You sign all local commits with your personal GPG key. release-please creates
> commits via the GitHub API using the automatic `GITHUB_TOKEN` — GitHub signs
> those commits with its own web-flow GPG key. On GitHub they appear with a green
> **Verified** badge, just signed by `GitHub` rather than by you. This is normal
> and expected for any bot-created commit. The merge commit when you click Merge
> on the release PR is similarly signed by GitHub's key, not yours.
>
> **Important**: the `release-please.yml` workflow must use `GITHUB_TOKEN` (the
> default automatic token) and not a custom PAT. Only `GITHUB_TOKEN`-based commits
> receive GitHub's web-flow signature. If you ever enable the `Require signed
> commits` branch protection rule on `main`, bot commits made via `GITHUB_TOKEN`
> will satisfy it; commits made via a custom PAT will not.

**6g.** Add `npm-run-all2` to root `devDependencies`. This replaces any
platform-specific parallel script runners so `npm run watch` works identically
on Windows (your dev machine) and Linux (CI runners):
```powershell
npm install --save-dev npm-run-all2
```
Update the root `watch` script to use `run-p` (parallel) from `npm-run-all2`.

### Future release workflow (after Phase 6 is complete)

Every future release follows this process — no manual version editing:

1. Write code, commit with Conventional Commit messages, push to `main`
2. `release-please.yml` runs automatically, opens or updates a release PR
3. When you are ready to release: go to GitHub, find the release PR, review
   the auto-generated CHANGELOG and version bump, merge it
4. release-please creates the `v*` tag automatically
5. `publish.yml` detects the tag, runs tests, packages all three VSIXs,
   publishes to marketplace, and creates the GitHub Release with attachments

### Verification gate
```powershell
npm run compile
npm test
cd gpg-bridge-agent      && npm run test:integration
cd ../gpg-bridge-request && npm run test:integration
```
Push a commit to `main` using a Conventional Commit prefix — release-please only
opens a release PR when it sees at least one qualifying commit since the last tag.
A minimal test commit:
```powershell
git commit --allow-empty -m "fix: verify release-please workflow"
git push
```
Then confirm in the GitHub Actions tab:
- `ci.yml` run passes
- `release-please.yml` run passes and opens a release PR titled `chore: release 1.0.1`
- The release PR diff shows a version bump from `1.0.0` → `1.0.1` and a
  CHANGELOG entry for the test fix commit

Do **not** merge that PR — it exists only to verify the workflow. Close it
without merging (release-please will reopen it with correct content when real
commits accumulate).

To verify `publish.yml` without publishing: inspect the workflow YAML and
 confirm the `VSCE_PAT` secret is accessible (GitHub shows whether a secret
exists without revealing its value).

---

## Files Changed Summary

| File / Path | Phase | Change type |
|-------------|-------|-------------|
| `agent-proxy/` → `gpg-bridge-agent/` | 1 | `git mv` |
| `request-proxy/` → `gpg-bridge-request/` | 1 | `git mv` |
| Root `package.json` | 1, 2 | Name, scripts, clean globs |
| `gpg-bridge-agent/package.json` | 1, 2, 3, 5 | Name, commands, scripts, deps, publisher, version |
| `gpg-bridge-request/package.json` | 1, 2, 3, 5 | Name, commands, scripts, deps, publisher, api:none, version |
| `shared/package.json` | 1 | Package name |
| `pack/package.json` | 1, 3, 4, 5 | Name, publisher, extensionPack IDs, icon, version |
| All `*.ts` source files | 1 | Command IDs, config keys, import paths, UI strings |
| All `*.ts` test + integration files | 1 | Command IDs, import paths |
| `gpg-bridge-agent/esbuild.js` (new) | 2 | Bundler config |
| `gpg-bridge-request/esbuild.js` (new) | 2 | Bundler config |
| Both `.vscodeignore` files | 2 | Add `node_modules/**` |
| `AGENTS.md` | 1 | Command IDs, import paths, workspace path |
| `CHANGELOG.md` | 1, 4 | Name refs, Keep-a-Changelog format |
| `README.md` × 3 | 1, 4 | Name refs, commands, config keys, polish, badges |
| `icon.png` × 3 (new) | 4 | 128×128 PNG in each extension root |
| `CONTRIBUTING.md` (new) | 4 | Dev setup, build, test, commit conventions |
| `.github/workflows/ci.yml` (new) | 6 | CI on push/PR |
| `.github/workflows/publish.yml` (new) | 6 | Publish on `v*` tag |
| `.github/workflows/release-please.yml` (new) | 6 | Release PR bot |
| `release-please-config.json` (new) | 6 | Monorepo version bump config |
| `.release-please-manifest.json` (new) | 6 | Release-please state file |

---

## Out of Scope

The following topics were considered during planning but are intentionally
excluded from this plan. Each is a candidate for a follow-on plan.

### VSIX-based integration tests
The current integration test suite loads extensions via
`--extensionDevelopmentPath` pointing at the compiled `out/` directory.
A separate test tier that installs the produced `.vsix` artifact and runs
against it would catch packaging bugs (wrong `.vscodeignore`, esbuild
omitting a module, bad `package.json` manifests) that the current suite
cannot detect. This requires restructuring the `runTest.ts` launch scripts,
adding a CI artifact stage, and defining smoke-test entry points — a
non-trivial effort that does not block first publish.

### Windows-specific CI runner
Phase 6 uses `ubuntu-latest`. A separate Windows runner job would validate
that the GPG4Win integration paths and socket file parsing work correctly in
CI, not just in local developer environments.


