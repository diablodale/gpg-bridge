# Version Compatibility Check Plan

## Overview

Extension versions are a VS Code packaging concern — neither `AgentProxy`, `RequestProxy`,
nor `PublicKeySync` has any reason to know about them. The check lives entirely in the two
`extension.ts` files.

**Approach:** The agent extension registers a new internal command
`_gpg-bridge-agent.checkVersion(remoteVersion)` alongside its existing inter-extension
commands. The request extension calls it once during its own `activate()` — before starting
any services — passing its own version string. On mismatch the agent throws a descriptive
error; the request extension catches it, shows an error notification with an "Open Extensions"
action button, and skips all service startup. `extensionDependencies` guarantees the agent is
fully activated before the request extension's `activate()` runs, so no lazy or deferred
checking is needed.

---

## Design Decisions

| Decision                   | Choice                                    | Rationale                                                                                                                                                  |
| -------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version equality           | Exact string match including pre-release  | `0.4.1-dev.6+abc` must not match `0.4.1`; dev builds must pair exactly                                                                                     |
| Check timing               | Eager — once in `activate()`              | `extensionDependencies` ensures agent is activated first; check before any service starts                                                                  |
| Failure behavior           | Hard block — skip all service startup     | No GPG operations are possible with mismatched versions                                                                                                    |
| Notification frequency     | Once per activation                       | Single check, single notification; no repeated pop-ups per client session                                                                                  |
| Version source             | `context.extension.packageJSON.version`   | VS Code runtime value; no file I/O, always matches what was packaged                                                                                       |
| Version exchange mechanism | `executeCommand` (VS Code command tunnel) | `vscode.extensions.getExtension()` cannot cross the UI↔workspace extension host boundary by design; the command tunnel is the correct cross-host mechanism |
| Service layer involvement  | None                                      | `AgentProxy`, `RequestProxy`, `PublicKeySync`, `ICommandExecutor`, and `shared/` are unchanged                                                             |
| New service class          | Not needed                                | Total logic is ~5 lines per `extension.ts`; a `VersionGuard` class would be over-engineering                                                               |

---

## Phase 1 — Agent: register `_gpg-bridge-agent.checkVersion`

**Files:** `gpg-bridge-agent/src/extension.ts`, `gpg-bridge-agent/src/test/`,
`gpg-bridge-agent/test/integration/`

### Work Items

- [x] Capture own version at activation: `const agentVersion = context.extension.packageJSON.version as string;`
- [x] Register `_gpg-bridge-agent.checkVersion` in the `context.subscriptions.push(...)` block
      alongside `connectAgent`, `sendCommands`, `disconnectAgent`, `exportPublicKeys`
- [x] Implement the check as an **exported pure function** so unit tests can call it directly
      without a VS Code host:
      `export function checkVersionHandler(agentVersion: string, remoteVersion: string): void`
  - If `remoteVersion === agentVersion`: return (no side effects)
  - If mismatch: throw `new RangeError(Version mismatch: agent=${agentVersion}, request=${remoteVersion})`
  - No logging, no VS Code API calls — pure input/output
- [x] Register the command as a thin wrapper `(v) => checkVersionHandler(agentVersion, v)`
- [x] Add the command registration to the trust model comment block (the existing comment
      that explains why internal commands are not access-restricted)

### Unit Tests — Phase 1

Add a new file `gpg-bridge-agent/src/test/checkVersion.test.ts`.
Import and call `checkVersionHandler` directly — no VS Code host needed, no mock of
`vscode.commands`. Follow the same module-level import pattern used in the existing agent
unit tests.

- [x] Clean exact match: `checkVersionHandler('0.4.0', '0.4.0')` → returns `undefined` without throwing
- [x] Dev exact match: `checkVersionHandler('0.4.0-dev.6+abc', '0.4.0-dev.6+abc')` → returns `undefined` without throwing
- [x] Clean patch mismatch: `checkVersionHandler('0.4.0', '0.4.1')` → throws `RangeError`;
      `instanceof RangeError` is true; message contains both `agent=0.4.0` and `request=0.4.1`
- [x] Dev vs clean mismatch: `checkVersionHandler('0.4.0-dev.6+abc', '0.4.0')` → throws `RangeError`;
      message contains both version strings
- [x] Different dev builds: `checkVersionHandler('0.4.0-dev.6+abc', '0.4.0-dev.7+def')` → throws `RangeError`;
      message contains both version strings

### Integration Tests — Phase 1

Add a new `describe` block in
`gpg-bridge-agent/test/integration/agentProxyIntegration.test.ts`.
These run inside the real VS Code extension host (via `runTest.ts`) against the activated
extension, exercising the command through `vscode.commands.executeCommand` the same way the
request extension will call it in production.

At the start of the `describe` block, fetch the agent's actual runtime version once:
`const agentVersion = vscode.extensions.getExtension('hidale.gpg-bridge-agent')?.packageJSON.version as string`

- [x] Pass `agentVersion` exactly → resolves (exact match — covers clean release or dev build
      depending on what was installed; dev-build exact match is covered by unit tests)
- [x] Pass `agentVersion + '-dev.1+test'` (append pre-release to real version) → rejects;
      error message contains both the agent version and the fabricated remote version
- [x] Pass `'0.0.0'` (different clean version) → rejects; error message contains both versions
- [x] Pass `'0.0.0-dev.1+abc'` (different dev version) → rejects; error message contains both
      versions and the thrown error is recognisable as a version mismatch (not a generic
      "not initialized" error)

### Verification Gate — Phase 1

- [x] `npm run compile` — no TypeScript errors
- [x] `npm run test` — all unit tests pass, new `checkVersion` unit test cases included
- [x] `npm run test:integration` — all integration tests pass, new `checkVersion`
      integration test cases included

---

## Phase 2 — Request: call `checkVersion` in `activate()`

**Files:** `gpg-bridge-request/src/extension.ts`

### Work Items

- [x] Read own version at activation start:
      `const requestVersion = context.extension.packageJSON.version as string;`
- [x] Implement the version gate as an **exported pure function** with optional DI so unit
      tests can call it without a VS Code host:

  ```typescript
  export async function runVersionCheck(
    requestVersion: string,
    deps?: {
      executeCommand?: (cmd: string, ...args: unknown[]) => Thenable<boolean>;
      showErrorMessage?: (msg: string, ...actions: string[]) => Thenable<string | undefined>;
      executeSearchCommand?: (cmd: string, query: string) => Thenable<void>;
    },
  ): Promise<boolean>; // true = versions match, false = mismatch (caller returns)
  ```

  - Calls `deps.executeCommand ?? vscode.commands.executeCommand` for `_gpg-bridge-agent.checkVersion`
  - On `RangeError` catch only: calls `deps.showErrorMessage ?? vscode.window.showErrorMessage`,
    handles "Open Extensions" click via `deps.executeSearchCommand ?? vscode.commands.executeCommand`;
    re-throws any non-`RangeError` so it propagates to `activate()`'s outer `catch` for logging
  - Returns `true` on success, `false` on `RangeError` mismatch (non-`RangeError` propagates)

- [x] In `activate()`, inside the `!isTestEnvironment() || isIntegrationTestEnvironment()` guard,
      **before** `startPublicKeySync()` and `startRequestProxy()`:
      `if (!await runVersionCheck(requestVersion)) return;`
- [x] Confirm `startPublicKeySync()` and `startRequestProxy()` are unreachable when
      `runVersionCheck` returns `false`

### Unit Tests — Phase 2

Add a new file `gpg-bridge-request/src/test/runVersionCheck.test.ts`.
Import and call `runVersionCheck` directly, passing mock functions for `executeCommand`,
`showErrorMessage`, and `executeSearchCommand` — no VS Code host needed.

- [x] Mock `executeCommand('_gpg-bridge-agent.checkVersion', ...)` resolves → `runVersionCheck`
      returns `true`
- [x] Mock `executeCommand('_gpg-bridge-agent.checkVersion', ...)` rejects → `runVersionCheck`
      returns `false`; `showErrorMessage` was called with text containing the error message
- [x] Mock rejects and `showErrorMessage` returns `'Open Extensions'` → `executeSearchCommand`
      called with `'hidale.gpg-bridge'`; `runVersionCheck` returns `false`

### Integration Tests — Phase 2

Add a new `describe` block in
`gpg-bridge-request/test/integration/requestProxyIntegration.test.ts`.
These run in the real VS Code extension host with both extensions activated; the agent's
`checkVersion` command is therefore live. At matching versions the proxy must start; a
fabricated mismatch (by calling `checkVersion` directly with a wrong version) must reject.

At the start of the `describe` block, fetch the agent's actual runtime version once.
The agent runs on the Windows UI host — `getExtension('hidale.gpg-bridge-agent')` returns
`undefined` from the Linux remote host (same cross-boundary constraint as the version exchange
mechanism). Use the request extension instead:
`const agentVersion = vscode.extensions.getExtension('hidale.gpg-bridge-request')?.packageJSON.version as string`
(valid because matching versions are the invariant). Add a `before()` hook to restart the proxy
if Phase 5's `afterEach` left it stopped.

- [x] Verify the request proxy socket exists and accepts connections after activation —
      confirms the version check passed and startup completed normally
- [x] Pass `agentVersion + '+build.1'` (build metadata appended to real version) → rejects;
      confirms build metadata is part of the exact match, not ignored
- [x] Pass `' ' + agentVersion` (leading whitespace) → rejects;
      confirms no implicit trimming
- [x] Pass `'99.0.0'` (major version ahead) → rejects; error message contains both versions

### Verification Gate — Phase 2

- [x] `npm run compile` — no TypeScript errors
- [x] `npm run test` — all unit tests pass, new request-side `checkVersion` unit test cases included
- [ ] `npm run test:integration` — all integration tests pass, new Phase 2 integration
      test cases included
- [ ] Manual smoke: install mismatched agent+request VSIX versions — verify:
  - Error notification appears with text containing both version strings
  - "Open Extensions" button opens the Extensions search panel filtered to `hidale.gpg-bridge`
  - No GPG Bridge Request output channel entry for socket start or key sync
  - GPG client connections are refused (bridge socket does not exist)
- [ ] Manual smoke: install matching versions — verify:
  - No error notification
  - Bridge starts normally; `gpg --list-keys` in remote terminal succeeds

---

## Out of Scope

- Agent-side mismatch notification — the request extension is the caller and owns the error
  handling; the agent's role is to detect and throw, not to decide what the user sees
- Version ranges or semver compatibility (`0.4.x` matching `0.4.y`) — exact match only
- User dismiss-and-continue override — mismatch always blocks
- CHANGELOG or version bump — version numbers are unchanged by this feature
