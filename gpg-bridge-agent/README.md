# GPG Bridge Agent

<img src="../assets/icon.png" alt="GPG Bridge Agent icon" width="96" align="right" />

<!-- Badges — update URLs after Phase 5 marketplace publish -->
<!-- ![Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/hidale.gpg-bridge-agent) -->

Manages authenticated connections to the Gpg4win agent on your Windows host.
Part of the [GPG Bridge](https://marketplace.visualstudio.com/items?itemName=hidale.gpg-bridge) pack —
install the pack rather than this extension directly.

## Requirements

- **Windows host only** — this extension activates only on `win32`
- [Gpg4win](https://www.gpg4win.org/) v4.4.1+ installed
- VS Code v1.91.0+

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gpgBridgeAgent.gpgBinDir` | *(auto-detect)* | Path to the GnuPG `bin` directory containing `gpgconf` (e.g. Gpg4win's `C:\Program Files\GnuPG\bin`). Leave empty to auto-detect. |
| `gpgBridgeAgent.debugLogging` | `false` | Enable verbose logging in the **GPG Bridge Agent** output channel |

## Commands

| Command | Description |
|---------|-------------|
| `GPG Bridge Agent: Start` | Start the agent proxy |
| `GPG Bridge Agent: Stop` | Stop the agent proxy |
| `GPG Bridge Agent: Show Status` | Show current proxy status and active session count |

The proxy starts automatically on VS Code launch. Manual commands are available via
the Command Palette (`Ctrl+Shift+P`) if you need to restart it.

## How It Works

1. Reads Gpg4win's `S.gpg-agent.extra` socket file to extract the TCP port and 16-byte nonce
2. Connects to `localhost:<port>` and authenticates by sending the nonce
3. Exposes three internal VS Code commands (`_gpg-bridge-agent.*`) that
   [GPG Bridge Request](https://marketplace.visualstudio.com/items?itemName=hidale.gpg-bridge-request)
   calls to connect, send commands, and disconnect — one session per GPG client connection
4. All Assuan protocol data passes through unchanged (`latin1` encoding preserves raw bytes)

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for
build setup, test instructions, and commit conventions.

For internal architecture details — state machine, public API, session management, and
testing approach — see
[docs/agent-internals.md](../docs/agent-internals.md).

