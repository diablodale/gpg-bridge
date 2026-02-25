# Feature Plan: Public Key Sync

## Problem

When connecting to a remote (SSH dev container, WSL, etc.) and installing both GPG Bridge
extensions, the Assuan protocol bridge works correctly — signing and decryption operations
are forwarded to the Windows GPG agent. However, GPG operations that require resolving a
key ID (e.g., `git log --show-signature`, `gpg --list-keys`, signing with an explicit key)
fail because the remote's public keyring (`~/.gnupg/pubring.kbx`) is empty.

The Windows GPG agent holds private key stubs. The public key material lives in the Windows
keyring (`pubring.kbx`) and is not accessible through the Assuan protocol bridge as-is.

## Architecture context

`gpg-bridge-agent` runs **on Windows** (local VS Code extension host — enforced by
`process.platform !== 'win32'` guard). It can spawn subprocesses on Windows via
`child_process`.

`gpg-bridge-request` runs **on the remote** (remote VS Code extension host — Linux,
WSL, container). It can spawn subprocesses on the remote via its `commandExecutor`.

They communicate across the host boundary via `vscode.commands.executeCommand`, which VS Code
routes between local and remote extension hosts transparently.

This means: agent can run `gpg --export` on Windows, request can run `gpg --import` on the
remote, and binary key data passes through the existing cross-host command channel.

## Behaviour spec

**New command** (visible in command palette): `gpg-bridge-request.syncPublicKeys` — sync
public keys from the Windows keyring to the remote keyring.
- Manual trigger: shows a multi-select QuickPick (agent-side) listing your key pairs as
  `<User-ID> [<short-key-ID>]` (e.g. `Alice <alice@example.com> [A1B2C3D4]`); user picks
  one or more keys to sync
- Auto-sync setting: `gpgBridgeRequest.autoSyncPublicKeys` (string, default `""`) — when
  non-empty, runs automatically **once on extension activation** using that value as
  the filter (see below); no QuickPick in auto-sync; does not re-run on proxy stop/restart
- Keys are left in the remote keyring after the session ends (no cleanup on deactivate)
- Direction: Windows → remote only
- Returns `undefined` if the user cancels the QuickPick; request treats that as a no-op

### `KeyFilter` — the filter parameter

The internal command `_gpg-bridge-agent.exportPublicKeys(filter?: KeyFilter)` accepts:

| Value | Behaviour |
|---|---|
| *(omitted)* | Shows interactive QuickPick; user selects from your key pairs |
| `"all"` | Headless — exports all public keys in the Windows keyring |
| `"pairs"` | Headless — exports public keys for all your key pairs (uses `gpg --list-secret-keys` internally) |
| any other string | Headless — treated as a GPG identifier (email, fingerprint, key ID, etc.) passed directly to `gpg --export` |

The `gpgBridgeRequest.autoSyncPublicKeys` setting value is passed as-is to `exportPublicKeys`.
Suggested values (`"all"`, `"pairs"`) are shown as enum hints in VS Code settings UI, but
any string is valid (email address, fingerprint, etc.). Empty string disables auto-sync.

---

## Implementation approach

The user-facing command still lives on the **remote** (request) extension. However, a single
new internal command `_gpg-bridge-agent.exportPublicKeys` encapsulates all Windows-side work:
it lists paired keys, shows the QuickPick, exports the selected keys, and returns the binary
data in one call. Request receives the `Uint8Array` and runs `gpg --import` locally.

One new internal command is added to `gpg-bridge-agent`:
- `_gpg-bridge-agent.exportPublicKeys(filter?: KeyFilter)` → conditionally shows QuickPick,
  runs `gpg --export`, returns `Uint8Array` (or `undefined` if user cancels)

`KeyFilter` is a shared type: `'all' | 'pairs' | string`. See the Behaviour spec above.

```mermaid
sequenceDiagram
    actor User
    participant Request as gpg-bridge-request<br/>(Linux remote)
    participant Agent as gpg-bridge-agent<br/>(Windows local)
    participant WinGPG as gpg (Windows)
    participant RemGPG as gpg (remote)

    alt Manual trigger (no filter)
        User->>Request: run command<br/>gpg-bridge-request.syncPublicKeys
        Request->>Agent: executeCommand<br/>_gpg-bridge-agent.exportPublicKeys()
        Agent->>WinGPG: gpg --list-secret-keys --with-colons
        WinGPG-->>Agent: colon-delimited key list
        Agent->>User: QuickPick — choose key(s)
        User-->>Agent: selection (or cancel → undefined)
        Agent->>WinGPG: gpg --export selected...
        WinGPG-->>Agent: binary public key data
        Agent-->>Request: Uint8Array
    else Auto-sync (filter = setting value, e.g. "pairs")
        Request->>Request: request proxy activated successfully
        Note over Request: autoSyncPublicKeys = "pairs"<br/>pass directly as filter
        Request->>Agent: executeCommand<br/>_gpg-bridge-agent.exportPublicKeys("pairs")
        Note over Agent: no QuickPick —<br/>list paired key fingerprints, export all
        Agent->>WinGPG: gpg --list-secret-keys --with-colons
        WinGPG-->>Agent: colon-delimited key list
        Agent->>WinGPG: gpg --export fpr1 fpr2...
        WinGPG-->>Agent: binary public key data
        Agent-->>Request: Uint8Array
    else Auto-sync (filter = email or fingerprint)
        Request->>Agent: executeCommand<br/>_gpg-bridge-agent.exportPublicKeys("user@example.com")
        Note over Agent: no QuickPick —<br/>pass identifier directly to gpg --export
        Agent->>WinGPG: gpg --export user@example.com
        WinGPG-->>Agent: binary public key data
        Agent-->>Request: Uint8Array
    end

    Request->>RemGPG: gpg --import (stdin = key data)
    RemGPG-->>Request: import result
    Request->>User: notification — N key(s) imported
```

**Pros**
- Single round-trip across the host boundary regardless of filter
- All Windows-side logic (list, QuickPick, export) is encapsulated inside one agent command
- `--with-colons` parsing stays in the agent — no shared parsing logic needed in request
- Request code is minimal: read setting → call command → receive data → import
- Consistent call direction: request → agent only
- `autoSyncPublicKeys` setting value maps directly to the `filter` param — no translation

**Cons**
- Agent command has a side effect (may show QuickPick UI) — less pure than a data-only command
- Two behavioural modes in one command (interactive vs. headless) — distinguished by presence
  of `filter` argument

---

## New files / changes

| File | Change |
|------|--------|
| `shared/src/gpgCli.ts` | New: production `GpgCli` base class — `PairedKeyInfo` interface; private `detect()`, `getBinDir()`, `gpgconfListDirs`, `listPairedKeys`, `exportPublicKeys`, `importPublicKeys`, `async cleanup()` (no-op in base; `GpgTestHelper` overrides); optional `gnupgHome` opt; `protected run()`/`runRaw()` |
| `shared/package.json` | Add `which` production dependency (synchronous PATH probing in `GpgCli` constructor) |
| `shared/src/index.ts` | Re-export `GpgCli`, `GpgCliOpts`, `PairedKeyInfo`, and `IGpgCliFactory` |
| `shared/src/types.ts` | Add `KeyFilter` type (`'all' \| 'pairs' \| string`); add `IGpgCliFactory` interface (`create(): GpgCli` — no params; caller closes over opts) |
| `shared/src/test/integration/gpgCli.ts` | Rename `GpgCli` → `GpgTestHelper`; extend production `GpgCli`; constructor (no required args) creates isolated temp dir via `mkdtempSync`, calls `assertSafeToDelete`, passes it as `gnupgHome` to `super()`, exposes `readonly gnupgHome: string` property and `async cleanup()` method; does **not** mutate `process.env`; remove duplicated subprocess infrastructure |
| `shared/src/test/integration/index.ts` | Update export: `GpgTestHelper` (and its opts/result types) |
| `gpg-bridge-agent/src/services/agentProxy.ts` | Add `gpgCliFactory?: IGpgCliFactory` to `AgentProxyDeps`; `AgentProxy` owns `private gpgCli: GpgCli \| null`; add `async start(): Promise<void>` (constructs `GpgCli` via factory, calls `gpgconfListDirs('agent-extra-socket')`, validates path exists); `stop()` calls `gpgCli.cleanup()`; add `getGpgBinDir(): string \| null` instance method; remove `AgentProxyConfig.gpgAgentSocketPath` |
| `gpg-bridge-agent/src/extension.ts` | Remove `detectGpgBinDir()`, `resolveAgentSocketPath()`, `detectedGpgBinDir`, `resolvedAgentSocketPath`; `startAgentProxy()` stays — reads `gpgBinDir` setting, constructs `AgentProxy` with `gpgCliFactory: { create: () => new GpgCli({ gpgBinDir }) }` closure, calls `await agentProxyService.start()`; `showStatus()` calls `agentProxyService.getGpgBinDir()`; register `_gpg-bridge-agent.exportPublicKeys` internal command |
| `gpg-bridge-agent/src/services/publicKeyExport.ts` | New: `exportPublicKeys(filter?: KeyFilter)` — QuickPick when no filter, headless otherwise; uses `GpgCli` |
| `gpg-bridge-request/src/extension.ts` | Register `gpg-bridge-request.syncPublicKeys` user command; hook auto-sync into activation |
| `gpg-bridge-request/src/services/publicKeySync.ts` | New: read filter from setting, call `_gpg-bridge-agent.exportPublicKeys`, run `gpgcli.importPublicKeys` locally |
| `gpg-bridge-request/src/services/requestProxy.ts` | Replace inline `spawnSync` in `getLocalGpgSocketPath()` with `gpgcli.gpgconfListDirs()`; socket file removal logic stays |
| `gpg-bridge-request/package.json` | Add `gpg-bridge-request.syncPublicKeys` to `contributes.commands`; add `gpgBridgeRequest.autoSyncPublicKeys` string setting (default `""`) with `"all"` and `"pairs"` as enum suggestions |
| All integration test files | Update `GpgCli` → `GpgTestHelper` at call sites |

## Shared `gpg` subprocess code

Both extensions already call `gpgconf` with nearly identical `spawnSync` patterns, and the
new feature adds `gpg --export` on the agent side and `gpg --import` on the request side —
a natural export/import pair. The overlap is real enough to extract:

| Extension | Existing subprocess calls | New subprocess calls |
|---|---|---|
| Agent | `gpgconf --list-dirs agent-extra-socket` | `gpg --list-secret-keys --with-colons`; `gpg --export [filter]` |
| Request | `gpgconf --list-dirs agent-socket`; `gpgconf --list-dirs agent-extra-socket` | `gpg --import` (stdin) |

The existing test `GpgCli` in `shared/src/test/integration/gpgCli.ts` already does many of
these operations, but with GNUPGHOME injection for keyring isolation, agent lifecycle
methods, and timeout/buffer parameters sized for stress tests. Using it directly in
production code is not appropriate — but duplicating the subprocess infrastructure is also
not appropriate.

**Decision**: production `GpgCli` as base class + test class renamed and extended.

### `GpgCli` — production base (`shared/src/gpgCli.ts`)

```typescript
/** One entry per key pair you own (parsed from `gpg --list-secret-keys --with-colons`). */
export interface PairedKeyInfo {
    fingerprint: string;  // 40-char hex primary key fingerprint
    userIds: string[];    // one or more UID strings (e.g. 'Alice <alice@example.com>')
}

export interface GpgCliOpts {
    gpgBinDir?: string;     // absolute directory path containing gpg and gpgconf;
                            // if omitted or '', detection runs at construction time
    gnupgHome?: string;     // if set, injected as GNUPGHOME in all subprocess calls
}

export class GpgCli {
    constructor(opts?: GpgCliOpts) {
        // If gpgBinDir is provided, validate it.
        // If empty/omitted, run private detection:
        //   1. which('gpgconf') — respects PATH, cross-platform
        //   2. probe well-known Windows Gpg4win locations (Windows only)
        // Throws at construction if no gpgconf can be found.
    }

    /** Return the resolved bin directory (useful for status display). */
    getBinDir(): string

    /** gpgconf --list-dirs <dirName> → trimmed path string */
    gpgconfListDirs(dirName: string): Promise<string>

    /** gpg --list-secret-keys --with-colons → one entry per key pair you own */
    listPairedKeys(): Promise<PairedKeyInfo[]>

    /** gpg --export [filter] → binary Uint8Array */
    exportPublicKeys(filter?: string): Promise<Uint8Array>

    /** gpg --import (stdin via `execFile` `input:` option — no temp file) → parsed result { imported: number; unchanged: number; errors: number } */
    importPublicKeys(keyData: Uint8Array): Promise<{ imported: number; unchanged: number; errors: number }>

    /** No-op in base class. Overridden by GpgTestHelper to kill agent + delete temp dir. */
    async cleanup(): Promise<void>

    // protected run() / runRaw() helpers (available to subclasses)

    private detect(): string   // runs PATH probe then well-known path probe; throws if nothing found
}
```

**Detection is private and runs once at construction.** The constructor is synchronous, so
detection uses synchronous probing:

1. If `gpgBinDir` provided: verify `gpgconf[.exe]` exists in that directory. Throw if not.
2. If empty/omitted:
   1. Try `whichSync('gpgconf')` — resolves from `PATH`, cross-platform, zero hardcoding.
      Returns the full binary path; `getBinDir()` returns `path.dirname()` of that.
   2. If `which` misses (returns null), probe well-known Windows Gpg4win directories with
      `fs.existsSync` (same list as the current `detectGpgBinDir()` function).
   3. Throw if nothing found.

`which` is a small, widely-used npm package already common in Node tooling. Since `whichSync`
is synchronous, no `async` constructor is needed. The `which` package is added as a
production dependency of `shared`.

Binary name resolution is internal: `path.join(binDir, process.platform === 'win32' ? 'gpg.exe' : 'gpg')`.

**`getBinDir()`** returns the resolved bin dir string. This replaces the module-level
`detectedGpgBinDir` variable in `gpg-bridge-agent/src/extension.ts` — the status dialog
calls `gpgCli.getBinDir()` instead of reading the module variable.

Typical agent-side usage, following Decisions 12 and 17 (`AgentProxy` owns `GpgCli`; `gpgBinDir` captured in factory closure):

```typescript
// agentProxy.ts — AgentProxy class owns the GpgCli instance
export class AgentProxy {
    private gpgCli: GpgCli | null = null;
    private gpgAgentSocketPath: string | null = null;
    private readonly gpgCliFactory?: IGpgCliFactory;
    // ... socketFactory, fileSystem, sessions ...

    constructor(config: AgentProxyConfig, deps?: Partial<AgentProxyDeps>) {
        // cheap: wire deps only — no subprocess, no validation
        this.gpgCliFactory = deps?.gpgCliFactory;
        this.socketFactory = deps?.socketFactory ?? { createConnection: net.createConnection };
        this.fileSystem = deps?.fileSystem ?? { existsSync: fs.existsSync, readFileSync: fs.readFileSync };
    }

    async start(): Promise<void> {
        // construct GpgCli via injected factory or default — throws if gpgconf not found
        this.gpgCli = this.gpgCliFactory?.create() ?? new GpgCli();
        this.gpgAgentSocketPath = await this.gpgCli.gpgconfListDirs('agent-extra-socket');
        if (!this.fileSystem.existsSync(this.gpgAgentSocketPath)) {
            throw new Error(`GPG agent socket not found: ${this.gpgAgentSocketPath}`);
        }
    }

    async stop(): Promise<void> {
        // ... tear down active sessions ...
        await this.gpgCli?.cleanup();
        this.gpgCli = null;
        this.gpgAgentSocketPath = null;
    }

    getGpgBinDir(): string | null {
        return this.gpgCli?.getBinDir() ?? null;
    }
}
```

```typescript
// extension.ts — reads gpgBinDir from VS Code config; closes over it in the factory
async function startAgentProxy(): Promise<void> {
    const gpgBinDir = vscode.workspace.getConfiguration('gpgBridgeAgent').get<string>('gpgBinDir') ?? '';
    agentProxyService = new AgentProxy(
        { logCallback, statusBarCallback },
        { gpgCliFactory: { create: () => new GpgCli({ gpgBinDir }) } }
    );
    await agentProxyService.start();
}

async function stopAgentProxy(): Promise<void> {
    await agentProxyService?.stop();
    agentProxyService = null;
}

function showStatus(): void {
    const gpgBinDir = agentProxyService?.getGpgBinDir() ?? '(not detected)';
    // ...
}
```

`AgentProxyConfig` no longer has `gpgAgentSocketPath` — `AgentProxy.start()` resolves it internally.

### `GpgTestHelper extends GpgCli` — test subclass (renamed, same file location)

The existing `GpgCli` in `shared/src/test/integration/gpgCli.ts` is **renamed** to
`GpgTestHelper`. It extends `GpgCli` from the production package:

```typescript
// shared/src/test/integration/gpgCli.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GpgCli } from '@gpg-bridge/shared';
import { assertSafeToDelete } from './helpers';

export class GpgTestHelper extends GpgCli {
    /** Absolute path to the isolated temp keyring created by this instance. */
    public readonly gnupgHome: string;

    /** Optional — override only when gpg is not on PATH (e.g. specific Gpg4win install). */
    constructor(opts?: { gpgBinDir?: string }) {
        const gnupgHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gpg-test-integration-'));
        assertSafeToDelete(gnupgHome);
        // gnupgHome is passed to super() so it is injected explicitly into every subprocess
        // call — process.env.GNUPGHOME is never mutated, keeping tests side-effect-free.
        super({ gpgBinDir: opts?.gpgBinDir, gnupgHome });
        this.gnupgHome = gnupgHome;
    }

    /**
     * Kill the gpg-agent (tolerates already-dead agent), validate the temp dir
     * path, then delete it. Always call in a finally block.
     */
    async cleanup(): Promise<void> {
        await this.killAgent();
        assertSafeToDelete(this.gnupgHome);
        fs.rmSync(this.gnupgHome, { recursive: true, force: true });
    }

    // Inherits: getBinDir, gpgconfListDirs, listPairedKeys, exportPublicKeys, importPublicKeys
    // Adds: writeAgentConf, launchAgent, killAgent, cleanup, generateKey, deleteKey,
    //        getFingerprint, getKeygrip, exportPublicKey (armor), version,
    //        listKeys, signFile, verifyFile, encryptFile, decryptFile
}
```

- No code duplication: all subprocess helpers come from the base class
- `gnupgHome` is passed to `super()` and injected explicitly into every subprocess env — `process.env.GNUPGHOME` is never mutated, so tests are side-effect-free
- Timeouts / maxBuffer overridden where needed (or accepted as-is if 5 s is fine for tests)
- All existing integration test call sites change `GpgCli` → `GpgTestHelper`; behaviour
  is identical

The existing `requestProxy.ts` `getLocalGpgSocketPath()` (which wraps `spawnSync` in a
needless `Promise` constructor) and the agent's `resolveAgentSocketPath()` are both
refactored to use `GpgCli.gpgconfListDirs()` instead.

## Decisions

1. **`gpg` binary path on Windows**: `GpgCli` constructor handles auto-detection; the agent
   extension passes the VS Code `gpgBridgeAgent.gpgBinDir` setting directly — no additional
   setting or path plumbing needed.
2. **`gpg` binary path on remote**: rely on `PATH` resolution for now; add a
   `gpgBridgeRequest.gpgBinDir` setting later only if a user reports a non-`PATH` install.
3. **`GpgCli` testability**: inject a mock `GpgCli` instance via the `*Deps` pattern for
   unit tests of `publicKeyExport.ts` and `publicKeySync.ts` (same pattern as `socketFactory`,
   `serverFactory`, etc.). Integration tests use `GpgTestHelper extends GpgCli` against an
   isolated keyring.
4. **Empty export result**: if `gpg --export <identifier>` returns zero bytes, the **agent**
   shows a VS Code warning message and returns `undefined` — keeping all UI agent-side; do
   not throw.
5. **User cancels QuickPick**: return `undefined`; request treats as a silent no-op.
6. **Key data size**: public keys are small (< 10 KB each); `Uint8Array` through the VS Code
   command channel is sufficient — no streaming needed.
7. **Notification placement**: show both a VS Code information message and write to the output
   channel after a successful import.
8. **QuickPick format**: multi-select; each item displays `<User-ID> [<short-key-ID>]`
   (e.g. `Alice <alice@example.com> [A1B2C3D4]`). User may select one or more items.
9. **Import result parsing**: `GpgCli.importPublicKeys()` parses `gpg --import` stdout and
   returns `{ imported: number; unchanged: number; errors: number }`. The caller
   (`publicKeySync.ts`) uses this struct to build the notification message.
10. **Auto-sync trigger**: fires once on **extension activation** (not on each proxy
    start/stop). Implemented as a separate `onActivate` call in
    `gpg-bridge-request/src/extension.ts`, independent of `startRequestProxy()`.
11. **Agent extension absent**: if `_gpg-bridge-agent.exportPublicKeys` is unavailable
    (extension not installed or not active), `syncPublicKeys` catches the rejection and
    shows a user-facing VS Code error message.
12. **`GpgCli` DI placement**: `GpgCli` construction lives inside the service layer
    (`agentProxy.ts`, `requestProxy.ts`), not in `extension.ts`. A `gpgCliFactory?: IGpgCliFactory`
    field is added to each service's `*Deps` interface, consistent with `ISocketFactory` and
    `IServerFactory`; unit tests inject an object implementing `IGpgCliFactory`; production code
    falls through to `new GpgCli(...)`.
17. **`AgentProxy` owns `GpgCli`**: `GpgCli` is a private field of `AgentProxy`, constructed
    in `start()` and cleaned up in `stop()`. `gpgBinDir` is not in `AgentProxyConfig` — it is
    read from VS Code config in `extension.ts` and captured in the `IGpgCliFactory.create()`
    closure there. `IGpgCliFactory.create()` takes no parameters. This mirrors how `RequestProxy`
    captures `getSocketPath` in its constructor deps, keeping all config-reading in the extension
    layer and all lifecycle in the service layer.
13. **`importPublicKeys` stdin mechanism**: key data is passed via `execFile`'s `input:` option
    — no temp file written to disk.
14. **QuickPick multi-UID keys**: display `userIds[0]` (the first UID) only. A key with no
    UIDs is skipped in the QuickPick list; it can still be exported headlessly by fingerprint.
15. **`exportPublicKeys` name collision**: `GpgCli` has a method `exportPublicKeys()` and
    `publicKeyExport.ts` exports a function also named `exportPublicKeys`. This is intentional
    — file scope makes the distinction clear; no rename needed.
16. **Phase 4 integration tests share the existing agent suite runner**: `publicKeyExport.test.ts`
    is added to `gpg-bridge-agent/test/integration/suite/index.ts`; no new runner or VS Code launch.

---

## Work phases

Each phase ends with: all new unit tests + all new integration tests + all pre-existing unit
and integration tests pass → update this plan (mark checkboxes) → git commit.

---

### Phase 1 — `GpgCli` production base class (`shared`) ✅ complete

**Files changed**: `shared/src/gpgCli.ts` (new), `shared/src/types.ts`, `shared/src/index.ts`,
`shared/package.json`

#### Work items
- [x] Add `which` as a production dependency in `shared/package.json`
- [x] Create `shared/src/gpgCli.ts` with `GpgCliOpts` interface and `GpgCli` class skeleton
- [x] Implement private `detect()`: `whichSync('gpgconf')` → PATH probe; fall back to
  well-known Windows Gpg4win directories; throw if not found
- [x] Implement constructor: accept `gpgBinDir` opt (validate) or run `detect()`; accept
  `gnupgHome` opt; store resolved paths
- [x] Implement `getBinDir(): string`
- [x] Implement `protected run()` / `runRaw()` helpers (spawn with optional `GNUPGHOME`)
- [x] Implement `gpgconfListDirs(dirName: string): Promise<string>`
- [x] Implement `listPairedKeys(): Promise<PairedKeyInfo[]>` (parses `--with-colons` output: `fpr:` records for fingerprints, `uid:` records for user IDs)
- [x] Re-export `PairedKeyInfo` from `shared/src/index.ts`
- [x] Implement `exportPublicKeys(filter?: string): Promise<Uint8Array>`
- [x] Implement `importPublicKeys(keyData: Uint8Array): Promise<{ imported; unchanged; errors }>`
  (pipes `keyData` to `gpg --import` stdin via `spawn`; parses `gpg --import` stderr; no temp file)
- [x] Add `KeyFilter = 'all' | 'pairs' | string` to `shared/src/types.ts`
- [x] Re-export `GpgCli`, `GpgCliOpts`, `KeyFilter` from `shared/src/index.ts`

#### Test cases

Tests are split into two groups:

**Unit tests** (`shared/src/test/gpgCli.test.ts`, new — mocked subprocesses, no real gpg required, no keyring access):
- [x] `GpgCli` constructor throws when `gpgBinDir` points to a directory without `gpgconf[.exe]`
- [x] `GpgCli` constructor succeeds when `gpgBinDir` is valid (filesystem check only, mock `fs.existsSync`)
- [x] `getBinDir()` returns the resolved directory
- [x] `gpgconfListDirs` returns trimmed path string (mock subprocess)
- [x] `gpgconfListDirs` throws on non-zero exit (mock subprocess)
- [x] `listPairedKeys` parses `--with-colons` output correctly — returns `PairedKeyInfo[]` with correct fingerprints and userIds (mock subprocess output)
- [x] `listPairedKeys` returns empty array for empty `--with-colons` output (mock subprocess)
- [x] `exportPublicKeys` returns `Uint8Array` of key data (mock subprocess)
- [x] `exportPublicKeys` returns empty `Uint8Array` when subprocess produces no output (mock subprocess)
- [x] `importPublicKeys` parses stdout: `{ imported: 1, unchanged: 0, errors: 0 }` (mock subprocess)
- [x] `importPublicKeys` parses stdout: already-imported key `{ imported: 0, unchanged: 1, errors: 0 }` (mock subprocess)
- [x] `GNUPGHOME` is injected into every subprocess call when `gnupgHome` opt is set (mock subprocess)
- [x] `GNUPGHOME` is absent from subprocess env when `gnupgHome` opt is not set (mock subprocess)

**Integration tests** (`shared/src/test/integration/gpgCli.test.ts`, new — real gpg subprocesses; `GpgTestHelper` does not exist yet;
tests set up the isolated keyring manually: `mkdtempSync` → `assertSafeToDelete` →
`new GpgCli({ gnupgHome: tmpHome })` → delete in `afterEach`; this boilerplate is
replaced by `new GpgTestHelper()` in Phase 2):
- [x] `GpgCli` constructor succeeds with no opts (real PATH probe finds `gpgconf`)
- [x] `gpgconfListDirs('agent-socket')` returns a valid path string against the isolated keyring
- [x] `listPairedKeys` returns `PairedKeyInfo[]` with correct fingerprints and userIds for keys generated in the isolated keyring
- [x] `exportPublicKeys('pairs')` round-trip: exported bytes are non-empty for a key pair in the isolated keyring
- [x] `importPublicKeys` round-trip: export from one isolated keyring, import into a second isolated keyring; result `imported: 1`

---

### Phase 2 — `GpgTestHelper` refactor (`shared` integration tests) ✅ complete

**Files changed**: `shared/src/gpgCli.ts`, `shared/src/index.ts`,
`shared/src/test/integration/gpgCli.ts`, `shared/src/test/integration/index.ts`,
`shared/src/test/integration/gpgCli.test.ts`,
`gpg-bridge-agent/test/integration/agentProxyIntegration.test.ts`,
`gpg-bridge-request/test/integration/gpgCliIntegration.test.ts`,
all three integration test runner files

#### Work items
- [x] Rename class `GpgCli` → `GpgTestHelper` in `shared/src/test/integration/gpgCli.ts`
- [x] Change `GpgTestHelper` to `extends GpgCli` (import from `@gpg-bridge/shared`)
- [x] Update constructor: `mkdtempSync` → `assertSafeToDelete` → `super({ gnupgHome })`; expose as `public readonly gnupgHome: string`; do **not** mutate `process.env.GNUPGHOME`
- [x] Add `async cleanup()`: `killAgent()` → `assertSafeToDelete` → `fs.rmSync`
- [x] Remove all duplicated subprocess infrastructure now inherited from `GpgCli`
- [x] Update `shared/src/test/integration/index.ts`: export `GpgTestHelper`
- [x] Update all integration test call sites in Mocha test files: `new GpgCli(...)` → `new GpgTestHelper()`
- [x] Update all three integration test runner files (`gpg-bridge-agent/test/integration/runTest.ts`,
  `gpg-bridge-request/test/integration/requestProxyRunTest.ts`,
  `gpg-bridge-request/test/integration/gpgCliRunTest.ts`):
  - Remove top-level `const GNUPGHOME = fs.mkdtempSync(...)`, `assertSafeToDelete(GNUPGHOME)`,
    and `process.env.GNUPGHOME = GNUPGHOME` boilerplate — constructor now handles creation
  - Change `const gpg = new GpgCli()` → `const gpg = new GpgTestHelper()`
  - Remove imports of `fs`, `os`, `assertSafeToDelete` that are no longer needed at top level
  - Replace `GNUPGHOME` constant with `gpg.gnupgHome` in `extensionTestsEnv` and anywhere else it is referenced
  - Replace `finally` block (manual `killAgent()` + `assertSafeToDelete` + `fs.rmSync`) with `await gpg.cleanup()`
- [x] Export `ExecFileError` and `GpgExecResult` interfaces from `shared/src/gpgCli.ts` and re-export from `shared/src/index.ts`
- [x] Unify `run()` and `runRaw()` return types to `Promise<GpgExecResult>`; update `ExecFileFn` to return `Promise<Pick<GpgExecResult, 'stdout' | 'stderr'>>` and `SpawnForStdinFn` to return `Promise<GpgExecResult>`
- [x] Make `gpgBin` and `gpgconfBin` `protected` so `GpgTestHelper` subclass can invoke them
- [x] Use `GpgCliOpts` (imported from `@gpg-bridge/shared`) as the constructor parameter type instead of an inline type
- [x] Extend `GpgTestHelper` constructor to accept optional `opts.gnupgHome` (via `GpgCliOpts`): when provided, wraps an existing keyring without taking ownership (`_ownsTempDir = false`) and `cleanup()` is a no-op; when omitted, behaviour is unchanged (`mkdtempSync`, full cleanup)
- [x] Fix `gpg-bridge-agent/test/integration/agentProxyIntegration.test.ts`: was importing `GpgCli` from test barrel; changed to `GpgTestHelper` constructed with `{ gnupgHome: process.env.GNUPGHOME! }` so it wraps the keyring prepared by `runTest.ts` without owning its lifecycle
- [x] Fix `gpg-bridge-request/test/integration/gpgCliIntegration.test.ts`: same issue — changed to `GpgTestHelper` constructed with `{ gnupgHome: LINUX_GNUPGHOME }`
- [x] Remove duplicate Phase 1 test blocks from `shared/src/test/integration/gpgCli.test.ts` (all superseded by Phase 2 block); merge best assertions from each into the surviving Phase 2 tests:
  - `gpgconfListDirs('agent-socket')`: add absolute path check from Phase 1
  - `listPairedKeys()` with key: add explicit `userIds.length === 1` and error messages from Phase 1
  - `exportPublicKeys()`: add error message; tighten `length > 0` → `length >= 300` (minimum for Ed25519+cv25519 binary packet)
  - `importPublicKeys()`: add `keyData.length >= 300` pre-check; add `JSON.stringify` in error messages from Phase 1
  - `listPairedKeys()` count: tighten `>= 1` → `=== 1` (isolated keyring, exactly one key generated)
  - Constructor tests: convert from synchronous `fs.rmSync` to `async`/`await helper.cleanup()`

#### Test cases

**Integration tests** (real gpg; each test constructs its own `GpgTestHelper()` which
creates an isolated temp dir automatically; `cleanup()` removes it in `afterEach`):
- [x] `new GpgTestHelper()` sets `gnupgHome` to a non-empty string pointing to a real temp directory
- [x] `new GpgTestHelper()` does **not** mutate `process.env.GNUPGHOME`
- [x] `getBinDir()` returns a non-empty string (confirms detection resolved a real gpg install)
- [x] `gpgconfListDirs('homedir')` returns the same path as `gnupgHome` (confirms GNUPGHOME injection)
- [x] `gpgconfListDirs('agent-socket')` returns a non-empty absolute path string
- [x] `listPairedKeys()` returns an empty array on a fresh empty keyring
- [x] `listPairedKeys()` returns exactly one `PairedKeyInfo` with correct fingerprint and userId for a single generated key
- [x] `exportPublicKeys()` returns `Uint8Array` of at least 300 bytes for a key pair (Ed25519+cv25519 minimum)
- [x] `importPublicKeys()` imports exported bytes (>= 300 bytes) into a second `new GpgTestHelper()` keyring; result has `imported: 1`, `errors: 0`
- [x] `cleanup()` removes the temp directory

---

### Phase 3 — Agent extension: replace detection with `GpgCli` ✅ complete

**Files changed**: `shared/src/types.ts`, `shared/src/index.ts`, `shared/src/gpgCli.ts`,
`gpg-bridge-agent/src/services/agentProxy.ts`, `gpg-bridge-agent/src/extension.ts`,
`gpg-bridge-agent/src/test/agentProxy.test.ts`,
`gpg-bridge-agent/test/integration/agentProxyIntegration.test.ts`,
`gpg-bridge-request/src/services/requestProxy.ts`

#### Work items
- [x] Add `IGpgCliFactory` interface to `shared/src/types.ts` (`create(): GpgCli` — no params);
  re-export from `shared/src/index.ts`
- [x] Add `async cleanup(): Promise<void>` no-op to `GpgCli` base class in `shared/src/gpgCli.ts`
- [x] Add `gpgCliFactory?: IGpgCliFactory` to `AgentProxyDeps` in `agentProxy.ts`
- [x] Add `private gpgCli: GpgCli | null` and `private gpgAgentSocketPath: string | null` fields
  to `AgentProxy` class
- [x] Add `async start(): Promise<void>` to `AgentProxy`: throw if already started (`gpgCli !== null`);
  construct `GpgCli` via `this.gpgCliFactory?.create() ?? new GpgCli()`; call
  `gpgconfListDirs('agent-extra-socket')`; throw if socket path does not exist
- [x] Update `AgentProxy.connectAgent()`: throw immediately with `'Agent proxy not started — call start() first'`
  if `this.gpgAgentSocketPath` is null
- [x] Update `AgentProxy.stop()`: call `await this.gpgCli?.cleanup()` before nulling it out
- [x] Add `getGpgBinDir(): string | null` instance method to `AgentProxy`
  (returns `this.gpgCli?.getBinDir() ?? null`)
- [x] Add `getAgentSocketPath(): string | null` instance method to `AgentProxy`
  (returns `this.gpgAgentSocketPath`)
- [x] Remove `AgentProxyConfig.gpgAgentSocketPath`; update constructor to not validate it
- [x] Update `extension.ts startAgentProxy()`: read `gpgBinDir` from VS Code config; construct
  `AgentProxy` with `gpgCliFactory: { create: () => new GpgCli({ gpgBinDir }) }` closure;
  call `await agentProxyService.start()`; remove `detectGpgBinDir()`, `resolveAgentSocketPath()`,
  `detectedGpgBinDir`, `resolvedAgentSocketPath`
- [x] Update `extension.ts showStatus()`: call `agentProxyService.getGpgBinDir() ?? '(not detected)'`
  and `agentProxyService.getAgentSocketPath() ?? '(not detected)'`
- [x] Fix `RequestProxy.start()`: add guard at top — throw if `this.server !== null`
  (`'Request proxy already started'`); mirrors the new `AgentProxy.start()` guard
- [x] Migrate existing `agentProxy.test.ts` constructor tests that exercised the old
  `gpgAgentSocketPath` validation: move validation assertions to `start()` tests; remove or
  update any test that constructs `AgentProxy` with `{ gpgAgentSocketPath: ... }`

#### Test cases (`gpg-bridge-agent/src/test/agentProxy.test.ts`)

**Unit tests** (mocked `GpgCli` via `AgentProxyDeps.gpgCliFactory` — no real gpg required):
- [x] `start()` calls `gpgCliFactory.create()` with no args and uses the returned mock
- [x] `start()` calls `gpgconfListDirs('agent-extra-socket')` on the constructed `GpgCli`
- [x] `start()` uses the `gpgconfListDirs` result as `gpgAgentSocketPath`
- [x] `start()` throws when the resolved socket path does not exist (mock `fileSystem.existsSync` returns false)
- [x] `start()` throws if called a second time without an intervening `stop()`
- [x] `start()` propagates `GpgCli` constructor throw (gpgconf not found → proxy fails to start)
- [x] `connectAgent()` throws `'Agent proxy not started'` when called before `start()`
- [x] `stop()` calls `cleanup()` on the `GpgCli` instance
- [x] `stop()` after `stop()` is a no-op (already null)
- [x] `getGpgBinDir()` returns `null` before `start()` is called
- [x] `getGpgBinDir()` returns `getBinDir()` result after `start()`
- [x] `getAgentSocketPath()` returns `null` before `start()` is called
- [x] `getAgentSocketPath()` returns the socket path resolved by `gpgconfListDirs` after `start()`

**Integration tests** (added to the existing `agentProxyIntegration.test.ts`;
`beforeEach`/`afterEach` stop the proxy so each test starts from a known stopped state):
- [x] `connectAgent()` throws `'Agent proxy not started'` when called before `start()`
- [x] `start` command when proxy already running returns gracefully without throwing

---

### Phase 4 — Agent extension: `exportPublicKeys` command ✅ complete

**Files changed**: `gpg-bridge-agent/src/services/publicKeyExport.ts` (new),
`gpg-bridge-agent/src/extension.ts`, `gpg-bridge-agent/src/services/agentProxy.ts`

#### Work items
- [x] Create `gpg-bridge-agent/src/services/publicKeyExport.ts`
- [x] Implement headless path: `filter === 'pairs'` → `listPairedKeys()` →
  `exportPublicKeys(keys.map(k => k.fingerprint).join(' '))`
- [x] Implement headless path: `filter === 'all'` → `exportPublicKeys()` (no args)
- [x] Implement headless path: any other string → `exportPublicKeys(filter)` directly
- [x] Implement interactive path: no filter → `listPairedKeys()` → build QuickPick items
  as `<User-ID> [<short-key-ID>]` from `PairedKeyInfo.userIds[0]` + last 8 chars of `fingerprint`
  → multi-select → `exportPublicKeys(selected.map(k => k.fingerprint).join(' '))`
- [x] Handle user cancels QuickPick → return `undefined`
- [x] Handle zero-byte export result → show VS Code warning message → return `undefined`
- [x] Register `_gpg-bridge-agent.exportPublicKeys` internal command in `extension.ts`,
  wired to the service function via `AgentProxy.exportPublicKeys(filter, deps?)`

#### Test cases (`gpg-bridge-agent/src/test/publicKeyExport.test.ts`)

**Unit tests** (mocked `GpgCli` via `*Deps` — no real gpg required):
- [x] `filter = 'pairs'`: calls `listPairedKeys()`, passes all fingerprints joined to `exportPublicKeys()`
- [x] `filter = 'all'`: calls `exportPublicKeys()` with no args
- [x] `filter = 'user@example.com'`: passes string directly to `exportPublicKeys()`
- [x] `filter = undefined`: QuickPick is shown, populated with items from `listPairedKeys()`
- [x] `filter = undefined`, user cancels QuickPick: returns `undefined`; `exportPublicKeys()` not called
- [x] Zero-byte export result: VS Code warning message shown; returns `undefined`
- [x] QuickPick items are formatted as `<User-ID> [<short-key-ID>]`
- [x] Multi-select: all selected fingerprints are passed in a single `exportPublicKeys()` call

**Integration tests** (real gpg via `GpgTestHelper`; tests share the existing agent integration
suite runner `gpg-bridge-agent/test/integration/runTest.ts` — add `publicKeyExport.test.ts` to
`suite/index.ts` if the glob doesn't already support it; the GNUPGHOME and live gpg-agent are already in place):
- [x] Keyring has 2 full key pairs + 1 public-only key (imported from isolated temp keyring)
- [x] `filter = 'pairs'`: returns `Uint8Array` ≥ 600 bytes (2 pairs); `filter = 'all'` strictly
  larger than `'pairs'` result (proves public-only key is included in `all` but excluded from `pairs`)
- [x] `filter = <test key fingerprint>`: returns `Uint8Array` ≥ 300 bytes matching that key
- [x] `filter = <email>`: returns `Uint8Array` ≥ 300 bytes matching that key
- [x] `filter = 'unknown@nomatch.invalid'`: `gpg --export` returns zero bytes → warning shown; returns `undefined`

---

### Phase 5 — Request extension: refactor `getLocalGpgSocketPath` ✅ complete

**Files changed**: `gpg-bridge-request/src/services/requestProxy.ts`,
`gpg-bridge-request/src/test/requestProxy.test.ts`,
`gpg-bridge-request/src/extension.ts` (removed stale `getSocketPath` bypass),
`gpg-bridge-request/test/integration/requestProxyIntegration.test.ts` (Phase 5 integration tests),
`.devcontainer/phase2/devcontainer.json` (updated comment — gnupg2 pre-installed in base image)

#### Work items
- [x] Add `gpgCliFactory?: IGpgCliFactory` to `RequestProxyDeps`; construct `gpgCli` inside `RequestProxy.start()` via `this.gpgCliFactory?.create() ?? new GpgCli()`
- [x] Replace inline `spawnSync` + `new Promise()` wrapper in `getLocalGpgSocketPath()` with
  `gpgcli.gpgconfListDirs('agent-socket')`
- [x] Replace the `agent-extra-socket` `spawnSync` call in `requestProxy.ts` with
  `gpgcli.gpgconfListDirs('agent-extra-socket')`
- [x] Move socket file removal logic inline in `start()` using `this.fileSystem` (injectable)
- [x] `stop()` calls `await this.gpgCli?.cleanup()` then nulls the field — mirrors `AgentProxy`
- [x] Remove `getLocalGpgSocketPath()` module-level function and `spawnSync` import
- [x] Remove `getSocketPathFn` and `usingMocks` fields; add `gpgCli` and `gpgCliFactory` fields
- [x] Verify socket file removal logic is unchanged (both paths still removed before binding)

#### Test cases (`gpg-bridge-request/src/test/requestProxy.test.ts`)

**Unit tests** (mocked `GpgCli` via `RequestProxyDeps.gpgCliFactory` — no real gpg required):
- [x] `start()` throws if called a second time without an intervening `stop()`
- [x] `getLocalGpgSocketPath` uses `gpgconfListDirs('agent-socket')` result as the returned path
- [x] `getLocalGpgSocketPath` propagates errors thrown by `gpgconfListDirs`
- [x] Socket file removal logic executes correctly (mock filesystem; `DualPathMockGpgCli` returns distinct paths for agent-socket vs agent-extra-socket; both are pre-seeded in `MockFileSystem`; verifies `unlinkSync` called for both)

**Integration tests** (real gpg via `GpgTestHelper` on the remote host):
- [x] `gpgconfListDirs('agent-socket')` returns a non-empty path string for the isolated keyring
- [x] Socket file removal: create a temp file at the returned path; verify the cleanup logic removes it

---

### Phase 6 — Request extension: `syncPublicKeys` command and auto-sync

**Files changed**: `gpg-bridge-request/src/services/publicKeySync.ts` (new),
`gpg-bridge-request/src/extension.ts`, `gpg-bridge-request/package.json`

#### Work items
- [ ] Create `gpg-bridge-request/src/services/publicKeySync.ts`
- [ ] Implement `syncPublicKeys(filter?: KeyFilter)`: call
  `executeCommand('_gpg-bridge-agent.exportPublicKeys', filter)` → if `undefined`, no-op →
  else call `gpgcli.importPublicKeys(data)` → show info message + log to output channel
- [ ] Handle `executeCommand` rejection (agent absent): show VS Code error message
- [ ] Register `gpg-bridge-request.syncPublicKeys` user command in `extension.ts`
- [ ] Add auto-sync `onActivate` hook in `extension.ts`: if `autoSyncPublicKeys` setting is
  non-empty, call `syncPublicKeys(settingValue)` once on activation
- [ ] Add `gpg-bridge-request.syncPublicKeys` to `contributes.commands` in `package.json`
- [ ] Add `gpgBridgeRequest.autoSyncPublicKeys` string setting in `package.json` (default
  `""`, enum suggestions `"all"` and `"pairs"`, with descriptions)

#### Test cases (`gpg-bridge-request/src/test/publicKeySync.test.ts`)

**Unit tests** (mocked `GpgCli` and mocked `executeCommand` — no real gpg or cross-host call):
- [ ] Manual trigger with no `autoSyncPublicKeys` setting: calls `executeCommand('_gpg-bridge-agent.exportPublicKeys')` with no filter
- [ ] Auto-sync with `autoSyncPublicKeys = "pairs"`: calls `executeCommand` with `"pairs"` as filter
- [ ] Auto-sync with `autoSyncPublicKeys = "all"`: calls `executeCommand` with `"all"` as filter
- [ ] Auto-sync with `autoSyncPublicKeys = "user@example.com"`: calls `executeCommand` with the email as filter
- [ ] `executeCommand` returns `undefined` (user cancelled / empty export): `importPublicKeys` not called; no error
- [ ] Successful import: `importPublicKeys` is called with the `Uint8Array`; VS Code info message shown; result written to output channel
- [ ] Agent absent (`executeCommand` rejects): VS Code error message shown; no import attempted
- [ ] Auto-sync does not fire when `autoSyncPublicKeys` is empty string
- [ ] Auto-sync fires exactly once at activation; a subsequent proxy stop/restart does not re-trigger it

**Integration tests** (real gpg via `GpgTestHelper` on the remote host; `executeCommand`
stubbed to supply key bytes — the cross-host VS Code bridge cannot be replicated in automated tests,
but the gpg import subprocess is real and isolated):
- [ ] Import round-trip: stub `executeCommand` to return the key bytes exported in Phase 4
  integration tests; `importPublicKeys` runs real `gpg --import` against the isolated remote
  keyring; result has `imported: 1`; key appears in that keyring
- [ ] Re-import of the same key against the same isolated keyring: result has `unchanged: 1, imported: 0`
- [ ] VS Code info message content includes the correct imported count from the parsed result
