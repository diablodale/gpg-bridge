# GPG Bridge Request

<img src="../assets/icon.png" alt="GPG Bridge Request icon" width="96" align="right" />

Creates a GPG agent Unix socket on remote environments (WSL, Dev Containers, SSH)
and forwards all GPG protocol operations to
[GPG Bridge Agent](https://marketplace.visualstudio.com/items?itemName=hidale.gpg-bridge-agent)
running on the local host.
Part of the [GPG Bridge](https://marketplace.visualstudio.com/items?itemName=hidale.gpg-bridge) pack —
install the pack rather than this extension directly.

## Requirements

- **Remote environments only** — this extension activates only in workspace (remote) context
- [GnuPG](https://gnupg.org/) 2.1+ installed on the remote (e.g. `gnupg` package on Linux/macOS)
- [GPG Bridge Agent](https://marketplace.visualstudio.com/items?itemName=hidale.gpg-bridge-agent) must be installed and running on the local host

## Configuration

| Setting                               | Default   | Description                                                                                                                                                                                                                                  |
| ------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpgBridgeRequest.gpgBinDir`          | _(auto)_  | Path to the GnuPG `bin` directory on the remote (e.g. `/usr/local/bin`). Leave empty to auto-detect via PATH.                                                                                                                                |
| `gpgBridgeRequest.autoSyncPublicKeys` | _(empty)_ | Automatically sync _public_ keys from the local keyring on activation.<ul><li>`"all"` = all public keys</li><li>`"pairs"` = public keys from matching key pairs</li><li>array of fingerprints/UIDs = public keys matching criteria</li></ul> |
| `gpgBridgeRequest.debugLogging`       | `false`   | Enable verbose logging in the **GPG Bridge Request** output channel                                                                                                                                                                          |

```jsonc
{
  // examples
  "gpgBridgeRequest.gpgBinDir": "/usr/bin",
  "gpgBridgeRequest.debugLogging": true,
  "gpgBridgeRequest.autoSyncPublicKeys": "pairs",
  "gpgBridgeRequest.autoSyncPublicKeys": ["jane@example.com", "51761A86"],
}
```

## Commands

| Command                                | Description                                                    |
| -------------------------------------- | -------------------------------------------------------------- |
| `GPG Bridge Request: Start`            | Start the request bridge                                       |
| `GPG Bridge Request: Stop`             | Stop the request bridge                                        |
| `GPG Bridge Request: Show Status`      | Display current proxy status and socket path                   |
| `GPG Bridge Request: Sync public keys` | Manually sync public keys from the local keyring to the remote |

The proxy starts automatically when VS Code connects to a remote. Manual commands
are available via the Command Palette (`Ctrl+Shift+P`) if you need to restart it.

## How It Works

1. Runs `gpgconf --list-dirs agent-socket` on the remote to locate the standard GPG agent socket path
2. Creates a Unix socket server at that path (replacing the normal gpg-agent socket)
3. Each connecting GPG client gets an independent session — calls `_gpg-bridge-agent.connectAgent`
   over VS Code's built-in tunnel to establish a connection through to gpg-agent on the local host
4. Buffers and forwards Assuan commands to the agent; forwards responses back to the client
5. Handles the full Assuan INQUIRE D-block pattern for operations that require client-supplied data

All socket I/O uses `latin1` encoding to preserve raw binary content unchanged.

## Security

### Socket permissions

The Unix socket and its parent directory are created with restrictive permissions:

- Socket directory: `0o700` — accessible only by the owning user
- Socket file: `0o600` — readable and writable only by the owning user

This prevents other users on the remote from connecting to the socket and forwarding
requests to your local gpg-agent.

### Transport

This extension does not open any network ports. All communication with GPG Bridge Agent
on the local host travels through VS Code's authenticated extension-host tunnel —
the same channel used for all remote extension communication. The bridge transparently
forwards Assuan protocol messages in both directions. Some operations — such as decryption
or passphrase retrieval — exchange sensitive data (for example, an asymmetric session key
or a symmetric passphrase) within those messages. The bridge does not inspect, filter, or
transform this content; what flows is determined entirely by gpg-agent's access controls.

### Trust model

The `S.gpg-agent.extra` restricted socket (used by GPG Bridge Agent) enforces command-level
access control: for example, `PRESET_PASSPHRASE` and `EXPORT_KEY` are rejected with
`ERR 67109115 Forbidden` before they execute, while `GET_PASSPHRASE` is permitted and
may return a cached passphrase. The bridge does not implement its own allowlist or
denylist — gpg-agent is the trust anchor for what remote clients may request.

### Custom GPG or hardened installation

By default the extension locates `gpgconf` by searching your remote's `PATH`.
This works for standard package-manager installs (`/usr/bin`, `/usr/local/bin`).
If you have compiled GnuPG from source, installed a newer version alongside the
system copy, or used a package manager with a non-standard prefix (e.g. Homebrew
on Linux, Nix, or Guix), set `gpgBridgeRequest.gpgBinDir` to the absolute `bin`
directory:

```json
"gpgBridgeRequest.gpgBinDir": "/opt/gnupg/bin"
```

When this setting is present the extension validates the explicit path and never consults `PATH`.
A directory placed early in `PATH` could shadow `gpgconf` with a malicious substitute
(a general PATH-injection risk, not specific to this extension). This is the recommended
configuration for shared machines or environments where `PATH` integrity cannot be fully trusted.

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for
build setup, test instructions, and commit conventions.

For internal architecture details — state machine, INQUIRE D-block buffering, session
management, and testing approach — see
[docs/request-internals.md](../docs/request-internals.md).
