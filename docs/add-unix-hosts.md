# Plan: Linux/macOS local host support (Unix socket transport)

## Background: Why Windows differs

On Windows (Gpg4win), `gpgconf --list-dirs agent-extra-socket` returns a path to a **regular
file** containing `<port>\n<16-byte nonce>`. gpg-agent listens on a loopback TCP port; clients
authenticate by sending the nonce as the first bytes. That is what `parseSocketFile()` and the
TCP+nonce connection path implement.

On **Linux/macOS**, the same command returns a path to a **Unix domain socket node** (e.g.
`/run/user/1000/gnupg/S.gpg-agent.extra`). There is no file to read, no port, no nonce. Clients
connect directly with `net.createConnection({ path })` and receive the `OK` greeting immediately
— no nonce exchange.

The goal is to detect which transport to use from the filesystem itself (regular file vs socket
node), not from `process.platform`. This keeps platform checks out of the business logic.

---

## Changes required

### 1. `shared/src/protocol.ts` — scope `parseSocketFile` to Windows

`parseSocketFile` is Windows-only. Rename to `parseWindowsAssuanSocketFile`. Call sites:

- `shared/src/index.ts`: exported via `export * from './protocol'` — no explicit change needed;
  any named import of `parseSocketFile` elsewhere will break at compile time and surface the
  required updates
- `shared/src/test/protocol.test.ts`: ~11 direct uses of the old name — update all
- `gpg-bridge-agent/src/services/agentProxy.ts`: one call site (in `connectAgent`) — update
- Comment at `agentProxy.test.ts` line 33 referencing `parseSocketFile()` — update

No logic changes — the rename clarifies intent and prevents accidental use on non-Windows.

### 2. `shared/src/types.ts` — add `statSync` to `IFileSystem`, generalize payload

**`IFileSystem`**: Add `statSync(path: string): IFileStats` returning a minimal interface:

```typescript
export interface IFileStats {
  isFile(): boolean;
  isSocket(): boolean;
}
```

Both consumers of the production fallback need updating:

- `AgentProxy` constructor: add `statSync: fs.statSync` alongside the existing `existsSync` and
  `readFileSync`. Remove the `as unknown as IFileSystem` cast once the object is complete.
- `RequestProxy` constructor: add `statSync: fs.statSync` alongside the existing five fields.

`MockFileSystem` in `shared/src/test/helpers.ts` also needs `statSync` (see change 8).

**`EventPayloads['CLIENT_CONNECT_REQUESTED']`**: Change to a discriminated union:

```typescript
| { port: number; nonce: Buffer }  // Windows: Assuan TCP emulation
| { unixPath: string }             // Linux/macOS: Unix domain socket
```

The shape (`'unixPath' in payload`) is a sufficient TypeScript discriminant — no extra `kind`
field needed.

### 3. `AgentSessionManager` — add Unix transport path

**Remove `pendingNonce` class field** — pass `nonce: Buffer | null` directly into
`wireSocketEvents`. The `connect` closure captures it and emits it as the
`AGENT_SOCKET_CONNECTED` payload:

```typescript
// AGENT_SOCKET_CONNECTED payload: undefined → { nonce: Buffer | null }
AGENT_SOCKET_CONNECTED: {
  nonce: Buffer | null;
}
```

`wireSocketEvents` gains a `nonce` parameter; its existing `connect` handler becomes:

```typescript
socket.once('connect', () => {
  this.emit('AGENT_SOCKET_CONNECTED', { nonce });
});
```

The `once` registration in the constructor must also thread the payload through:

```typescript
this.once('AGENT_SOCKET_CONNECTED', (payload) => this.handleAgentSocketConnected(payload));
```

**Remove `getSocket()` and `setSocket()`**: `getSocket` has no callers and can be deleted.
`setSocket` is called only once internally — inline `this.socket = socket;` and
`this.wireSocketEvents(socket, nonce)` directly in `handleClientConnectRequested`.

**`handleClientConnectRequested`** — no explicit branch needed:

Use the shape discriminant `'unixPath' in payload` to call `socketFactory.createConnection`
with the appropriate params.
For TCP payload: `{ host: 'localhost', port }` — pass `nonce` to `wireSocketEvents`.
For Unix payload: `{ path: unixPath }` — pass `null` to `wireSocketEvents`.
No `pendingNonce` assignment. No platform check.

**`handleAgentSocketConnected`** — nonce arrives in the event payload:

Check `payload.nonce !== null`. For TCP (non-null): existing nonce-send behavior — emit
`CLIENT_DATA_RECEIVED` with the nonce buffer. For Unix (`null`): emit
`AGENT_WRITE_OK({ requiresTimeout: true })` directly — skips the write step, transitions
straight to `WAITING_FOR_AGENT`, and reuses the existing `handleAgentWriteOk` timer logic.

This requires **one new state transition only** — `SOCKET_CONNECTED + AGENT_WRITE_OK →
WAITING_FOR_AGENT` — added to `STATE_TRANSITIONS`. No new event, no new handler, no
duplication of the greeting timeout setup.

**Stale comments to update in `agentProxy.ts`:**

- `SessionState.CONNECTING_TO_AGENT`: `// TCP socket connection in progress` → `// socket connection in progress`
- `SessionState.SOCKET_CONNECTED`: `// Socket connected, ready to send nonce` → `// Socket connected, nonce pending (TCP) or greeting expected (Unix)`
- `AgentSessionManagerConfig.greetingTimeoutMs` comment: `nonce authentication timeout` → `greeting response timeout`
- `STATE_TRANSITIONS.SOCKET_CONNECTED.CLIENT_DATA_RECEIVED` comment: `// Nonce send begins` → `// TCP: nonce send begins`; add new entry `AGENT_WRITE_OK: 'WAITING_FOR_AGENT'` with comment `// Unix: skip nonce write, proceed to greeting wait`
- `handleAgentSocketConnected` JSDoc: remove "emits CLIENT_DATA_RECEIVED with nonce"; update to reflect `payload.nonce` branch logic
- `handleAgentWriteOk` JSDoc transition line: `SOCKET_CONNECTED → WAITING_FOR_AGENT (after nonce)` → `SOCKET_CONNECTED → WAITING_FOR_AGENT (after nonce write, or directly on Unix)`

### 4. `AgentProxy.start()` — validate socket path exists

The existing `existsSync` check in `start()` is sufficient for startup validation — no change
needed. Transport detection belongs in `connectAgent()` (see change 5), where it is actually
used and where re-detecting on each connection is cheap and avoids stale cached state.

The GETEVENTCOUNTER probe that follows is pure Assuan and works identically on both transports.

Update `start()` JSDoc: `"validate the socket file exists"` → `"validate the socket path exists"`.

### 5. `AgentProxy.connectAgent()` — detect transport inline, emit typed payload

Call `statSync` inline at the top of `connectAgent()` to determine transport type:

```typescript
const stats = this.fileSystem.statSync(this.gpgAgentSocketPath);
if (stats.isSocket()) {
  session.emit('CLIENT_CONNECT_REQUESTED', { unixPath: this.gpgAgentSocketPath });
} else if (stats.isFile()) {
  const { port, nonce } = parseWindowsAssuanSocketFile(
    this.fileSystem.readFileSync(this.gpgAgentSocketPath),
  );
  session.emit('CLIENT_CONNECT_REQUESTED', { port, nonce });
} else {
  throw new Error(`GPG agent socket path is not a socket or file: ${this.gpgAgentSocketPath}`);
}
```

No class field needed — transport type is a local concern of this function. No `process.platform`
check. `statSync` throws `ENOENT` if the path has disappeared since `start()`, which is handled
by the existing error path. Add a TOCTOU comment for the Unix path mirroring the existing TCP one.

Stale socket note: if gpg-agent has exited but left a socket node on disk, `statSync().isSocket()`
still returns `true`. The subsequent `net.createConnection` will fail with `ECONNREFUSED`, which
propagates through `ERROR_OCCURRED → CLEANUP_REQUESTED` normally — no special handling needed.

**Stale comments to update in this function:**

- JSDoc paragraph `"via TCP socket with nonce authentication"`: update to note both transports
- JSDoc state flow `"SOCKET_CONNECTED → SENDING_TO_AGENT (nonce) → WAITING_FOR_AGENT"`: add Unix path note that SENDING_TO_AGENT is skipped
- The existing TOCTOU comment block moves into the TCP branch intact — it is already Windows-specific and remains correct there
- Log message `"Found config: localhost:${port} with nonce"` moves into the TCP branch — no change needed

### 6. `extension.ts` — remove Windows-only activation guard

- Remove the `process.platform !== 'win32'` guard that currently returns early on non-Windows
- Update user-facing log strings and error messages that reference "Windows" or "Gpg4win"
- In `GpgCli.detect()`, update the final `throw` message from _"Please install Gpg4win or set
  gpgBridgeAgent.gpgBinDir"_ to a platform-neutral alternative (e.g. _"gpgconf not found. Install
  GnuPG or set `gpgBridgeAgent.gpgBinDir` to its bin directory"_). No other changes to `detect()`
  — the existing `whichSync('gpgconf')` call already covers Linux/macOS (resolves from `PATH`
  including `/usr/bin/gpgconf`, `/opt/homebrew/bin/gpgconf`, etc.).

### 7. `gpg-bridge-agent/package.json`

- Remove `"os": ["win32"]` (or extend to `["win32", "linux", "darwin"]`)
- Update `"description"`, `"virtualWorkspaces"`, and `"untrustedWorkspaces"` text to remove
  Windows-only wording
- `"extensionKind": ["ui"]` remains correct — the agent must co-locate with the gpg-agent socket
  on the local machine, and `"ui"` already prevents accidental server-side installation in a VS
  Code Remote setup

### 8. `shared/src/test/helpers.ts` — Unix socket support in mocks

**`MockFileSystem`**: Add `statSync` returning a `MockFileStats` object. `setFile` registers a
regular file (`isFile() = true`, `isSocket() = false`). Add a `setSocket` method that registers
a socket node (`isSocket() = true`, `isFile() = false`).

**`MockSocketFactory`**: Add `emitGreetingOnConnect: boolean` flag (default `false`). When
`true`, the factory emits a greeting `data` event immediately after the `connect` event fires —
simulating Unix domain socket behavior where no nonce write precedes the greeting. When `false`,
existing behavior is unchanged.

For Unix-mode probe tests, `setNextSocketResponses` needs only 3 entries (no nonce write):
greeting is emitted by `emitGreetingOnConnect`, then GETINFO → OK, GETEVENTCOUNTER → ERR
Forbidden, BYE → OK+close.

### 9. `agentProxy.test.ts` — new tests for Unix transport

- New `describe('Unix socket transport')` block inside `connectAgent` and `start() socket probe`
  tests
- Default `beforeEach` remains Windows-mode (regular file, TCP); Unix-mode tests call
  `mockFileSystem.setSocket(socketPath, ...)` and `mockSocketFactory.emitGreetingOnConnect = true`
  — no platform stubbing needed
- Tests to add:
  - `connectAgent()` detects socket node and emits `{ unixPath }` payload
  - `start()` throws a clear error when path is neither file nor socket
  - `connectAgent()` routes `{ unixPath }` to `createConnection({ path })`
  - `AGENT_SOCKET_CONNECTED` carries `{ nonce: null }` on Unix path
  - Greeting is returned without any nonce write
  - `start()` probe completes in Unix mode (3 queue entries, `emitGreetingOnConnect`)
- Existing Windows tests unaffected

---

## What does NOT change

| Item                                                                  | Reason                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Assuan command/response framing                                       | Transport-agnostic                                                                               |
| `handleClientDataReceived`, `sendCommands`, `disconnectAgent`, `stop` | No transport dependency                                                                          |
| `detectResponseCompletion`, `encodeProtocolData`                      | Transport-agnostic                                                                               |
| GETEVENTCOUNTER probe logic                                           | Identical Assuan command on both transports                                                      |
| `GpgCli.gpgconfListDirs`                                              | Already cross-platform                                                                           |
| Session state machine states                                          | Unchanged; only 1 new transition added (`SOCKET_CONNECTED + AGENT_WRITE_OK → WAITING_FOR_AGENT`) |
| `getSocket()`, `setSocket()` — **removed**                            | `getSocket` had no callers; `setSocket` inlined                                                  |
| `request-proxy` extension                                             | Local-side agent is always separate from remote request-proxy                                    |

---

## Open questions

_None — all resolved._
