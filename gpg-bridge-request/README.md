# GPG Bridge Request

<img src="../assets/icon.png" alt="GPG Bridge Request icon" width="96" align="right" />

<!-- Badges — update URLs after Phase 5 marketplace publish -->
<!-- ![Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/hidale.gpg-bridge-request) -->

Creates a GPG agent Unix socket on remote environments (WSL, Dev Containers, SSH)
and forwards all GPG protocol operations to
[GPG Bridge Agent](https://marketplace.visualstudio.com/items?itemName=hidale.gpg-bridge-agent)
running on the Windows host.
Part of the [GPG Bridge](https://marketplace.visualstudio.com/items?itemName=hidale.gpg-bridge) pack —
install the pack rather than this extension directly.

## Requirements

- **Remote environments only** — this extension activates only in workspace (remote) context
- [GPG Bridge Agent](https://marketplace.visualstudio.com/items?itemName=hidale.gpg-bridge-agent) must be installed and running on the Windows host
- `gpgconf` available on the remote (standard with any GnuPG installation)

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gpgBridgeRequest.debugLogging` | `false` | Enable verbose logging in the **GPG Bridge Request** output channel |

## Commands

| Command | Description |
|---------|-------------|
| `GPG Bridge Request: Start` | Start the request proxy |
| `GPG Bridge Request: Stop` | Stop the request proxy |

The proxy starts automatically when VS Code connects to a remote. Manual commands
are available via the Command Palette (`Ctrl+Shift+P`) if you need to restart it.

## How It Works

1. Runs `gpgconf --list-dirs agent-socket` on the remote to locate the standard GPG agent socket path
2. Creates a Unix socket server at that path (replacing the normal gpg-agent socket)
3. Each connecting GPG client gets an independent session — calls `_gpg-bridge-agent.connectAgent`
   over VS Code's built-in tunnel to establish a connection through to Gpg4win on Windows
4. Buffers and forwards Assuan commands to the agent; forwards responses back to the client
5. Handles the full Assuan INQUIRE D-block pattern for operations that require client-supplied data

All socket I/O uses `latin1` encoding to preserve raw binary content unchanged.

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for
build setup, test instructions, and commit conventions.

For internal architecture details — state machine, INQUIRE D-block buffering, session
management, and testing approach — see
[docs/request-internals.md](../docs/request-internals.md).
