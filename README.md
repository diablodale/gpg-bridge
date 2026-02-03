# GPG Windows Relay for VS Code

**Windows-only extension** that relays GPG agent protocols between Linux remotes (WSL, Dev Containers, SSH) and Windows host running Gpg4win.

## 🎯 Purpose

When working in a remote Linux environment from VS Code on Windows, GPG operations (signing commits, decrypting files) typically fail because the remote can't access your Windows GPG keys. This extension bridges that gap by forwarding GPG agent requests from the remote to your Windows Gpg4win installation.

## ⚠️ Requirements

- **Windows host** (this extension only runs on Windows)
- **Gpg4win** installed on Windows
- **npiperelay.exe** for pipe/socket bridging (optional, will be auto-installed)
- Remote environment: WSL, Dev Container, or SSH

## 📦 Installation

1. Build the extension:
   ```powershell
   npm install
   npm run compile
   ```

2. Install in VS Code:
   - Press `F5` to launch Extension Development Host, OR
   - Package with `npm run package` and install the `.vsix` file

## 🚀 Usage

### Commands

- **GPG Windows Relay: Start** - Start the relay service
- **GPG Windows Relay: Stop** - Stop the relay service
- **GPG Windows Relay: Restart** - Restart the relay
- **GPG Windows Relay: Show Status** - Display current relay status

### Configuration

Open VS Code settings and configure:

```json
{
  "gpgWinRelay.gpg4winPath": "C:\\Program Files (x86)\\GnuPG\\bin",
  "gpgWinRelay.npiperelayPath": "npiperelay.exe",
  "gpgWinRelay.autoStart": true,
  "gpgWinRelay.debugLogging": false
}
```

### Typical Workflow

1. Open VS Code on Windows
2. Connect to WSL/Container/SSH remote
3. Run command **GPG Windows Relay: Start** (or enable auto-start)
4. GPG operations in the remote will now work with your Windows keys

## 🔧 Architecture & Design

**Pure Node.js solution** leveraging VS Code's native remote infrastructure. No external dependencies (no socat, no npiperelay).

### How Assuan Sockets Work

Gpg4win exposes the GPG agent via an Assuan socket file containing:
```text
<TCP_PORT>
<16_BYTE_NONCE>
```

The relay reads this file and connects to `localhost:<TCP_PORT>`, sends the nonce for authentication, then pipes data bidirectionally.

### WSL 🎯 *Priority #1*

```text
WSL /run/user/1000/gnupg/S.gpg-agent
    ↓
Node.js Unix socket listener
    ↓
localhost:PORT (tunneled by VS Code WSL extension)
    ↓
Windows Node.js TCP server
    ↓
Read Assuan socket file → parse port + nonce
    ↓
Connect to localhost:<ASSUAN_PORT> with nonce auth
    ↓
Gpg4win gpg-agent (Assuan socket)
```

**Characteristics:**

- Single Node.js process on Windows (TCP server)
- Single Node.js process in WSL (Unix socket listener)
- VS Code WSL extension automatically tunnels `localhost:PORT`
- No external dependencies

**Implementation:**

- [ ] Windows: Create TCP server bridging to Assuan socket
- [ ] WSL: Run Node.js script creating Unix socket listener
- [ ] Bidirectional piping with proper error handling

---

### Dev Container 🎯 *Priority #2*

```text
Container /run/user/1000/gnupg/S.gpg-agent
    ↓
Node.js Unix socket listener
    ↓
localhost:PORT (tunneled by VS Code container extension)
    ↓
Windows Node.js TCP server
    ↓
Read Assuan socket file → parse port + nonce
    ↓
Connect to localhost:<ASSUAN_PORT> with nonce auth
    ↓
Gpg4win gpg-agent (Assuan socket)
```

**Characteristics:**

- Identical to WSL architecture
- VS Code container extension handles port forwarding automatically
- Single unified Node.js implementation for both

**Implementation:**

- [ ] Reuse Windows TCP server from WSL implementation
- [ ] Deploy Node.js script into container
- [ ] VS Code automatically handles port tunneling

---

### SSH Remote 🎯 *Priority #3*

```text
Remote /run/user/1000/gnupg/S.gpg-agent
    ↓
Node.js Unix socket listener
    ↓
localhost:PORT (tunneled by VS Code SSH extension)
    ↓
Windows Node.js TCP server
    ↓
Read Assuan socket file → parse port + nonce
    ↓
Connect to localhost:<ASSUAN_PORT> with nonce auth
    ↓
Gpg4win gpg-agent (Assuan socket)
```

**Characteristics:**

- Identical architecture
- VS Code SSH extension handles SSH tunneling automatically
- Single unified Node.js implementation

**Implementation:**

- [ ] Reuse Windows TCP server from WSL implementation
- [ ] Deploy Node.js script to remote via SSH
- [ ] VS Code automatically handles SSH tunneling

---

## 🛠️ Core Implementation Tasks

### Phase 1: Relay Strategy Infrastructure

- [ ] Abstract relay strategy interface to support multiple remote types
- [ ] Create `RelayStrategy` base class with methods:
  - `getRemoteType()`: Detect and return the remote type
  - `startRelay()`: Execute the remote-specific relay setup
  - `stopRelay()`: Clean up remote-specific processes
  - `validateSetup()`: Pre-flight checks for the strategy
- [ ] Implement detection logic in `extension.ts` to select the right strategy
- [ ] Create reusable Windows Assuan bridge service

### Phase 2: Windows Assuan Bridge (MVP) ⭐

Implement the core Windows-side TCP server:

- [ ] Parse Assuan socket file (`C:\Users\...\AppData\Roaming\gnupg\S.gpg-agent`)
- [ ] Extract TCP port and 16-byte nonce
- [ ] Create TCP server listening on configurable port (default 63331)
- [ ] On connection:
  - Connect to `localhost:<ASSUAN_PORT>` (from socket file)
  - Send nonce for authentication
  - Pipe bidirectionally: incoming → gpg-agent, outgoing → client
- [ ] Handle connection lifecycle and errors
- [ ] Integrate with `GpgRelay` class in extension

### Phase 3: WSL Remote Support ⭐

Deploy Node.js relay script to WSL:

- [ ] Create remote relay script (`remoteRelay.js`)
- [ ] Script creates Unix socket listener at `/run/user/1000/gnupg/S.gpg-agent`
- [ ] On connection: create TCP connection to `localhost:PORT` (tunneled to Windows)
- [ ] Pipe bidirectionally: Unix socket ↔ TCP
- [ ] Deploy script to WSL via SSH when relay starts
- [ ] Run script in background when WSL is connected
- [ ] Handle script cleanup/termination

### Phase 4: Dev Container Support 🎯

Reuse Windows Assuan bridge + remote relay script:

- [ ] Detect container via VS Code extension API
- [ ] Deploy remote relay script to container (via docker exec / SSH)
- [ ] VS Code container extension automatically tunnels `localhost:PORT`
- [ ] Start relay script in container background
- [ ] Handle container reconnection scenarios

### Phase 5: SSH Remote Support 🎯

Reuse Windows Assuan bridge + remote relay script:

- [ ] Detect SSH remote via VS Code extension API
- [ ] Deploy remote relay script via SSH
- [ ] Establish port forwarding via VS Code SSH API
- [ ] Start relay script on remote
- [ ] Handle SSH connection stability

### Phase 6: Robustness & Polish

- [ ] Error recovery and auto-restart on connection loss
- [ ] Proper cleanup on extension deactivation
- [ ] Configuration validation per strategy
- [ ] Comprehensive logging for debugging
- [ ] Unit tests for each component
- [ ] User-friendly error messages

## 🛠️ Development

Run the extension in debug mode:

```powershell
# Press F5 in VS Code, or:
npm run watch
```

Then press `F5` to launch the Extension Development Host.

## 📝 Status

**Current implementation status:**

- ✅ Extension scaffold and commands
- ✅ Remote detection
- ✅ Configuration management
- ⏳ Relay strategy infrastructure (Phase 1)
- ⏳ **Windows Assuan bridge (Phase 2) — MVP focus**
- ⏳ **WSL remote support (Phase 3) — MVP focus**
- 🔮 Dev container support (Phase 4) — after MVP
- 🔮 SSH remote support (Phase 5) — after MVP

**MVP Scope:** Pure Node.js solution with no external dependencies. Get WSL working robustly. Dev Containers and SSH reuse the same architecture.

## 📄 License

See LICENSE file.
